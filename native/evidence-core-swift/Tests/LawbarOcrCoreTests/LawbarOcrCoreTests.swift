// LawbarOcrCore tests (product plan R3, WI-12 step 1).
//
// Self-contained: every page is generated in the test, so no fixture file is read and nothing
// resembling a client document exists. What is pinned:
//   * the probe reports a helper digest, OS build, arch and Vision's languages, and zh-Hans is among them
//   * a PDF with a REAL text layer: PDFKit returns the text intact, and Vision on the render agrees —
//     the two independent readings that the caller's verification compares
//   * a scanned PDF (image only): the text layer is empty and Vision reads the drawn text
//   * a single image behaves like a one-page scan
//   * a page range beyond the document is refused with the range and the count, not silently clipped
//   * an unreadable file is refused as such, not reported as an empty page
//   * every record carries the same helper digest, and the render digest is stable for the same page

import XCTest
import Foundation
import PDFKit
@testable import LawbarOcrCore

final class LawbarOcrCoreTests: XCTestCase {
    private func tempFile(_ name: String, _ data: Data) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("lawbar-ocr-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try data.write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return url
    }

    private func collect(_ url: URL, range: ClosedRange<Int>? = nil, layerOnly: Bool = false) throws -> [PageRecord] {
        var out: [PageRecord] = []
        var options = Extract.Options()
        options.layerOnly = layerOnly
        try Extract.run(file: url, range: range, options: options) { out.append($0) }
        return out
    }

    private func compact(_ s: String) -> String { s.replacingOccurrences(of: "\\s", with: "", options: .regularExpression) }

    func testProbeReportsIdentityAndZhHans() {
        let p = LawbarOcrCore.probe(roundtrip: true)
        XCTAssertEqual(p.kind, "probe")
        XCTAssertEqual(p.helper_build_digest.count, 64, "a sha256 hex of the running executable")
        XCTAssertFalse(p.os_build.isEmpty)
        XCTAssertFalse(p.arch.isEmpty)
        XCTAssertTrue(p.vision_languages.contains("zh-Hans"), "zh-Hans must be an offline Vision language here: \(p.vision_languages)")
        XCTAssertNotNil(p.roundtrip_ms)
        XCTAssertEqual(compact(p.roundtrip_text ?? ""), "合同", "the built-in synthetic round-trip must read back exactly")
    }

    func testTextLayerPDF_layerIntactAndVisionAgrees() throws {
        let text = "民事判决书"
        let url = try tempFile("layer.pdf", try XCTUnwrap(SyntheticPage.textLayerPDF(text: text)))
        let pages = try collect(url)
        XCTAssertEqual(pages.count, 1)
        let p = pages[0]
        XCTAssertEqual(p.source, "pdf")
        XCTAssertNil(p.error)
        XCTAssertEqual(compact(p.layer_text ?? ""), text, "PDFKit must return the text layer intact")
        XCTAssertEqual(p.layer_chars, text.count)
        XCTAssertEqual(compact(p.vision_text ?? ""), text, "Vision on the render is the independent reading the caller compares against")
        XCTAssertGreaterThan(p.render_width ?? 0, 0)
        XCTAssertEqual(p.render_digest?.count, 64)
    }

    func testScannedPDF_noLayerVisionReads() throws {
        let text = "合作协议"
        let url = try tempFile("scan.pdf", try XCTUnwrap(SyntheticPage.scannedPDF(text: text)))
        let p = try XCTUnwrap(try collect(url).first)
        XCTAssertEqual(p.layer_chars, 0, "a scan has no text layer")
        XCTAssertEqual(compact(p.vision_text ?? ""), text)
        let first = try XCTUnwrap(p.vision_lines?.first, "Vision must return at least one line")
        XCTAssertGreaterThan(first.confidence, 0.5)
    }

    func testImageBehavesLikeOnePageScan() throws {
        let img = try XCTUnwrap(SyntheticPage.make(text: "证据目录"))
        let tiff = try XCTUnwrap(img.tiffRepresentation)
        let png = try XCTUnwrap(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        let url = try tempFile("page.png", png)
        let pages = try collect(url)
        XCTAssertEqual(pages.count, 1)
        XCTAssertEqual(pages[0].source, "image")
        XCTAssertNil(pages[0].layer_text)
        XCTAssertEqual(compact(pages[0].vision_text ?? ""), "证据目录")
        XCTAssertThrowsError(try collect(url, range: 1...2)) { err in
            XCTAssertEqual(err as? Extract.Failure, .pageOutOfRange(requested: 1...2, pageCount: 1))
        }
    }

    func testPageRangeBeyondDocumentIsRefusedNotClipped() throws {
        let url = try tempFile("layer.pdf", try XCTUnwrap(SyntheticPage.textLayerPDF(text: "x")))
        XCTAssertThrowsError(try collect(url, range: 1...3)) { err in
            XCTAssertEqual(err as? Extract.Failure, .pageOutOfRange(requested: 1...3, pageCount: 1))
        }
        XCTAssertThrowsError(try collect(url, range: 0...1))
    }

    func testUnreadableInputIsRefusedAsSuch() throws {
        let url = try tempFile("garbage.pdf", Data("not a pdf, not an image".utf8))
        XCTAssertThrowsError(try collect(url)) { err in
            XCTAssertEqual(err as? Extract.Failure, .unreadableInput("garbage.pdf"))
        }
    }

    func testEveryRecordCarriesTheSameHelperDigestAndRenderIsStable() throws {
        let url = try tempFile("layer.pdf", try XCTUnwrap(SyntheticPage.textLayerPDF(text: "稳定")))
        let a = try XCTUnwrap(try collect(url).first)
        let b = try XCTUnwrap(try collect(url).first)
        XCTAssertEqual(a.helper_build_digest, b.helper_build_digest)
        XCTAssertEqual(a.helper_build_digest, Digest.selfDigest())
        XCTAssertEqual(a.render_digest, b.render_digest, "the same page renders to the same bytes — the identity a citation can be checked against")
    }


    func testLayerOnly_readsTheLayerAndTouchesNothingElse() throws {
        let text = "民事判决书"
        let url = try tempFile("layer.pdf", try XCTUnwrap(SyntheticPage.textLayerPDF(text: text)))
        let p = try XCTUnwrap(try collect(url, layerOnly: true).first)
        XCTAssertEqual(p.mode, "layer_only")
        XCTAssertEqual(compact(p.layer_text ?? ""), text)
        XCTAssertEqual(p.layer_chars, text.count)
        XCTAssertNotNil(p.layer_ms, "the layer read is timed")
        XCTAssertNil(p.vision_text, "nothing was recognised")
        XCTAssertNil(p.vision_ms)
        XCTAssertNil(p.render_digest, "nothing was rendered")
        XCTAssertNil(p.render_ms)
        XCTAssertNil(p.error)
        // The JSON omits what was not measured rather than printing zeros for it.
        let json = String(decoding: try JSONEncoder().encode(p), as: UTF8.self)
        XCTAssertFalse(json.contains("vision_ms"), json)
        XCTAssertFalse(json.contains("render_digest"), json)
        XCTAssertTrue(json.contains("\"mode\":\"layer_only\""), json)
    }

    func testLayerOnly_scanAndImageReportNoLayerWithoutRecognising() throws {
        let scan = try tempFile("scan.pdf", try XCTUnwrap(SyntheticPage.scannedPDF(text: "合作协议")))
        let s = try XCTUnwrap(try collect(scan, layerOnly: true).first)
        XCTAssertEqual(s.mode, "layer_only")
        XCTAssertEqual(s.layer_chars, 0)
        XCTAssertNil(s.vision_text)
        let img = try XCTUnwrap(SyntheticPage.make(text: "证据目录"))
        let png = try tempFile("page.tiff", try XCTUnwrap(img.tiffRepresentation))
        let i = try XCTUnwrap(try collect(png, layerOnly: true).first)
        XCTAssertEqual(i.source, "image")
        XCTAssertEqual(i.layer_chars, 0)
        XCTAssertNil(i.layer_ms, "an image has no layer to time")
        XCTAssertNil(i.vision_text)
    }

    func testFullModeStillMeasuresEverythingAndSaysSo() throws {
        let url = try tempFile("layer.pdf", try XCTUnwrap(SyntheticPage.textLayerPDF(text: "民事判决书")))
        let p = try XCTUnwrap(try collect(url).first)
        XCTAssertEqual(p.mode, "full")
        XCTAssertNotNil(p.layer_ms)
        XCTAssertNotNil(p.vision_ms)
        XCTAssertNotNil(p.render_ms)
        XCTAssertNotNil(p.render_digest)
    }

    func testFileDigestIsSha256() throws {
        let url = try tempFile("bytes.bin", Data("abc".utf8))
        XCTAssertEqual(try Digest.sha256Hex(ofFile: url), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
