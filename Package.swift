// swift-tools-version:5.9
// At the root so a SwiftPM dependency on this repository resolves, as
// wisent-errors does.
import PackageDescription

let package = Package(
    name: "WisentTexts",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "WisentTexts", targets: ["WisentTexts"])],
    targets: [
        .target(name: "WisentTexts", path: "swift/Sources/WisentTexts"),
        .testTarget(name: "WisentTextsTests", dependencies: ["WisentTexts"], path: "swift/Tests/WisentTextsTests"),
    ]
)
