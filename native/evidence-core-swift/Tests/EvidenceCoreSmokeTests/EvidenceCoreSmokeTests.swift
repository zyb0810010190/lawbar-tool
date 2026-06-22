import XCTest
@testable import EvidenceCoreSmoke

final class EvidenceCoreSmokeTests: XCTestCase {
    func testSmokeVersion() {
        XCTAssertEqual(EvidenceCoreSmoke.smokeVersion, "0.0.0-smoke")
    }

    func testSmokeValue() {
        XCTAssertTrue(EvidenceCoreSmoke.smoke().contains("skeleton ok"))
    }
}
