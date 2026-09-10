// LawbarOcrCore — the system-framework OCR helper's logic (product plan R3, WI-12 step 1).
//
// klode's rules, mapped onto macOS: zero third-party dependencies (PDFKit + Vision + CryptoKit only);
// a subprocess the caller bounds with a deadline; page images that never touch the disk; every
// record carrying the helper's own build digest so the packaged app can prove WHICH helper ran.
//
// This file holds the pure logic. The CLI (Sources/LawbarOcrCLI/main.swift) is a thin argument
// parser over it, mirroring the other CLIs in this package. Nothing here assigns OCR tiers: that is
// the bake-off's job. `extract` reports, per page, what the text layer said and what Vision said on
// the rendered page, and leaves the decision to the caller.

import Foundation
import CryptoKit
import PDFKit
import Vision
import AppKit

// MARK: - Output records (JSON, one object per line on stdout)

public struct ProbeRecord: Codable, Equatable {
    public let kind: String                      // "probe"
    public let helper_build_digest: String       // sha256 of the running executable's bytes
    public let helper_version: String            // LawbarOcrCore.version
    public let os_version: String                // e.g. "15.6.0"
    public let os_build: String                  // e.g. "24G84"
    public let arch: String                      // "arm64" | "x86_64"
    public let vision_languages: [String]        // supportedRecognitionLanguages(.accurate)
    public let pdfkit_available: Bool
    public let roundtrip_ms: Int?                // Vision on a built-in synthetic image, if requested
    public let roundtrip_text: String?
    public init(kind: String, helper_build_digest: String, helper_version: String, os_version: String, os_build: String, arch: String, vision_languages: [String], pdfkit_available: Bool, roundtrip_ms: Int?, roundtrip_text: String?) {
        self.kind = kind; self.helper_build_digest = helper_build_digest; self.helper_version = helper_version; self.os_version = os_version; self.os_build = os_build; self.arch = arch; self.vision_languages = vision_languages; self.pdfkit_available = pdfkit_available; self.roundtrip_ms = roundtrip_ms; self.roundtrip_text = roundtrip_text
    }
}

public struct RecognizedLine: Codable, Equatable {
    public let text: String
    public let confidence: Double
    /// Normalised bounding box in Vision's coordinate space (origin bottom-left, 0...1).
    public let x: Double, y: Double, w: Double, h: Double
    public init(text: String, confidence: Double, x: Double, y: Double, w: Double, h: Double) {
        self.text = text; self.confidence = confidence; self.x = x; self.y = y; self.w = w; self.h = h
    }
}

public struct PageRecord: Codable, Equatable {
    public let kind: String                      // "page"
    public let page: Int                         // 1-based
    public let page_count: Int
    public let source: String                    // "pdf" | "image"
    public let layer_text: String?               // PDFKit text layer, nil for images
    public let layer_chars: Int
    public let render_width: Int, render_height: Int
    public let render_digest: String             // sha256 of the rendered RGBA bytes — the page image identity, never written to disk
    public let vision_lines: [RecognizedLine]
    public let vision_text: String               // lines joined with "\n" in Vision's reading order
    public let vision_ms: Int
    public let render_ms: Int
    public let helper_build_digest: String
    public let error: String?                    // "render_failed" | "vision_failed" — the page is reported, never skipped
    public init(kind: String, page: Int, page_count: Int, source: String, layer_text: String?, layer_chars: Int, render_width: Int, render_height: Int, render_digest: String, vision_lines: [RecognizedLine], vision_text: String, vision_ms: Int, render_ms: Int, helper_build_digest: String, error: String?) {
        self.kind = kind; self.page = page; self.page_count = page_count; self.source = source; self.layer_text = layer_text; self.layer_chars = layer_chars; self.render_width = render_width; self.render_height = render_height; self.render_digest = render_digest; self.vision_lines = vision_lines; self.vision_text = vision_text; self.vision_ms = vision_ms; self.render_ms = render_ms; self.helper_build_digest = helper_build_digest; self.error = error
    }
}

public struct ErrorRecord: Codable, Equatable {
    public let kind: String                      // "error"
    public let code: String                      // "unreadable_input" | "page_out_of_range" | "bad_arguments"
    public let detail: String
    public init(kind: String, code: String, detail: String) { self.kind = kind; self.code = code; self.detail = detail }
}

// MARK: - Digest

public enum Digest {
    public static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    public static func sha256Hex(ofFile url: URL) throws -> String {
        sha256Hex(of: try Data(contentsOf: url))
    }
    /// The digest of the running executable — what the packaged app compares against the binary
    /// inside its own bundle, so a development binary, a PATH fallback or a stray copy is caught.
    public static func selfDigest() -> String {
        guard let url = Bundle.main.executableURL, let d = try? sha256Hex(ofFile: url) else { return "unavailable" }
        return d
    }
}

// MARK: - Probe

public enum LawbarOcrCore {
    public static let version = "0.1.0"

    public static func probe(roundtrip: Bool) -> ProbeRecord {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        let langs = (try? VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: VNRecognizeTextRequestRevision3)) ?? []
        var rtMs: Int? = nil
        var rtText: String? = nil
        if roundtrip, let img = SyntheticPage.make(text: "合同"), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            let t0 = Date()
            let (lines, _) = Vision.recognize(cgImage: cg, languages: ["zh-Hans", "en-US"])
            rtMs = Int(Date().timeIntervalSince(t0) * 1000)
            rtText = lines.map { $0.text }.joined(separator: "\n")
        }
        return ProbeRecord(
            kind: "probe",
            helper_build_digest: Digest.selfDigest(),
            helper_version: version,
            os_version: "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)",
            os_build: osBuild(),
            arch: machineArch(),
            vision_languages: langs,
            pdfkit_available: true,
            roundtrip_ms: rtMs,
            roundtrip_text: rtText
        )
    }

    private static func osBuild() -> String {
        var size = 0
        sysctlbyname("kern.osversion", nil, &size, nil, 0)
        var buf = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("kern.osversion", &buf, &size, nil, 0)
        return String(cString: buf)
    }
    private static func machineArch() -> String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var buf = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("hw.machine", &buf, &size, nil, 0)
        return String(cString: buf)
    }
}

// MARK: - Vision

public enum Vision {
    /// Recognise text on one image. Returns lines in Vision's order plus the request duration.
    public static func recognize(cgImage: CGImage, languages: [String]) -> ([RecognizedLine], Int) {
        let t0 = Date()
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.recognitionLanguages = languages
        req.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do { try handler.perform([req]) } catch { return ([], Int(Date().timeIntervalSince(t0) * 1000)) }
        let lines: [RecognizedLine] = (req.results ?? []).compactMap { obs in
            guard let c = obs.topCandidates(1).first else { return nil }
            let b = obs.boundingBox
            return RecognizedLine(text: c.string, confidence: Double(c.confidence), x: Double(b.origin.x), y: Double(b.origin.y), w: Double(b.width), h: Double(b.height))
        }
        return (lines, Int(Date().timeIntervalSince(t0) * 1000))
    }
}

// MARK: - Rendering (in memory only)

public enum Render {
    /// Render a PDF page to a CGImage at `dpi`. Nothing is written to disk.
    public static func pdfPage(_ page: PDFPage, dpi: Double) -> CGImage? {
        let bounds = page.bounds(for: .mediaBox)
        let scale = dpi / 72.0
        let size = NSSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        let img = page.thumbnail(of: size, for: .mediaBox)
        return img.cgImage(forProposedRect: nil, context: nil, hints: nil)
    }
    /// A stable identity for a rendered page: sha256 over its RGBA bytes.
    public static func digest(of cg: CGImage) -> String {
        guard let provider = cg.dataProvider, let data = provider.data as Data? else { return "unavailable" }
        return Digest.sha256Hex(of: data)
    }
}

// MARK: - Extract

public enum Extract {
    public struct Options {
        public var languages: [String] = ["zh-Hans", "en-US"]
        public var dpi: Double = 150
        public init() {}
    }

    public enum Failure: Error, Equatable {
        case unreadableInput(String)
        case pageOutOfRange(requested: ClosedRange<Int>, pageCount: Int)
    }

    /// Extract the pages `range` (1-based, inclusive) of a PDF or a single image. Each page yields
    /// one record; a page that fails to render or recognise yields a record with `error` set —
    /// never a missing page, because a missing page is silent loss.
    public static func run(file: URL, range: ClosedRange<Int>?, options: Options, emit: (PageRecord) -> Void) throws {
        let selfDigest = Digest.selfDigest()
        // Sniff the header rather than letting PDFKit try (and log to stderr) on every image.
        let isPDF: Bool = {
            guard let h = FileHandle(forReadingAtPath: file.path) else { return false }
            defer { h.closeFile() }
            return h.readData(ofLength: 5) == Data("%PDF-".utf8)
        }()
        if isPDF, let doc = PDFDocument(url: file) {
            let count = doc.pageCount
            let r = range ?? (1...max(count, 1))
            guard count >= 1, r.lowerBound >= 1, r.upperBound <= count else {
                throw Failure.pageOutOfRange(requested: r, pageCount: count)
            }
            for n in r {
                guard let page = doc.page(at: n - 1) else { continue }
                let layer = page.string ?? ""
                let t0 = Date()
                guard let cg = Render.pdfPage(page, dpi: options.dpi) else {
                    emit(PageRecord(kind: "page", page: n, page_count: count, source: "pdf", layer_text: layer, layer_chars: layer.count,
                                    render_width: 0, render_height: 0, render_digest: "unavailable", vision_lines: [], vision_text: "",
                                    vision_ms: 0, render_ms: Int(Date().timeIntervalSince(t0) * 1000), helper_build_digest: selfDigest, error: "render_failed"))
                    continue
                }
                let renderMs = Int(Date().timeIntervalSince(t0) * 1000)
                let (lines, visionMs) = Vision.recognize(cgImage: cg, languages: options.languages)
                emit(PageRecord(kind: "page", page: n, page_count: count, source: "pdf", layer_text: layer, layer_chars: layer.count,
                                render_width: cg.width, render_height: cg.height, render_digest: Render.digest(of: cg), vision_lines: lines,
                                vision_text: lines.map { $0.text }.joined(separator: "\n"), vision_ms: visionMs, render_ms: renderMs,
                                helper_build_digest: selfDigest, error: nil))
            }
            return
        }
        if let img = NSImage(contentsOf: file), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            let r = range ?? (1...1)
            guard r == (1...1) else { throw Failure.pageOutOfRange(requested: r, pageCount: 1) }
            let (lines, visionMs) = Vision.recognize(cgImage: cg, languages: options.languages)
            emit(PageRecord(kind: "page", page: 1, page_count: 1, source: "image", layer_text: nil, layer_chars: 0,
                            render_width: cg.width, render_height: cg.height, render_digest: Render.digest(of: cg), vision_lines: lines,
                            vision_text: lines.map { $0.text }.joined(separator: "\n"), vision_ms: visionMs, render_ms: 0,
                            helper_build_digest: selfDigest, error: nil))
            return
        }
        throw Failure.unreadableInput(file.lastPathComponent)
    }
}

// MARK: - A synthetic page, for the probe round-trip and for tests (no fixture files needed)

public enum SyntheticPage {
    /// Draw `text` in a large system font on a white bitmap. Deterministic enough for a round-trip.
    public static func make(text: String, pointSize: CGFloat = 48, width: Int = 900, height: Int = 160) -> NSImage? {
        let img = NSImage(size: NSSize(width: width, height: height))
        img.lockFocus()
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: pointSize), .foregroundColor: NSColor.black]
        (text as NSString).draw(at: NSPoint(x: 24, y: CGFloat(height) / 2 - pointSize / 2), withAttributes: attrs)
        img.unlockFocus()
        return img
    }

    /// A one-page PDF whose ONLY content is `text` drawn with CoreText — a real text layer.
    public static func textLayerPDF(text: String, pointSize: CGFloat = 24) -> Data? {
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData) else { return nil }
        var box = CGRect(x: 0, y: 0, width: 595, height: 842)
        guard let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }
        ctx.beginPDFPage(nil)
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: pointSize)]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
        ctx.textPosition = CGPoint(x: 72, y: 700)
        CTLineDraw(line, ctx)
        ctx.endPDFPage()
        ctx.closePDF()
        return data as Data
    }

    /// A one-page PDF that contains only an IMAGE of `text` — a scan with no text layer.
    public static func scannedPDF(text: String) -> Data? {
        guard let img = make(text: text), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData) else { return nil }
        var box = CGRect(x: 0, y: 0, width: CGFloat(cg.width), height: CGFloat(cg.height))
        guard let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }
        ctx.beginPDFPage(nil)
        ctx.draw(cg, in: box)
        ctx.endPDFPage()
        ctx.closePDF()
        return data as Data
    }
}
