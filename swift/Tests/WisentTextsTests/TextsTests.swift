import Foundation
import XCTest
@testable import WisentTexts

final class TextsTests: XCTestCase {
    private let bundle = Data(#"{"product":"t","source":"en","texts":{"a":"For {hours} hours","b":"Deny"},"translations":{"pl":{"a":"Na {hours} godz."}}}"#.utf8)

    func testALanguageReadsItsWordsAndFallsBackToEnglish() throws {
        let texts = try Texts(bundle: bundle)
        XCTAssertEqual(texts.say("a", in: "pl_PL.UTF-8", ["hours": "3"]), "Na 3 godz.")
        XCTAssertEqual(texts.say("b", in: "pl"), "Deny")
        XCTAssertEqual(texts.say("a", in: "xx", ["hours": "2"]), "For 2 hours")
        XCTAssertEqual(texts.say("unknown", in: "pl"), "unknown")
    }

    func testABundleWithoutTextsIsRefused() {
        XCTAssertThrowsError(try Texts(bundle: Data(#"{"translations":{}}"#.utf8))) { error in
            XCTAssertTrue(String(describing: error).contains("write it with texts bundle"))
        }
    }
}
