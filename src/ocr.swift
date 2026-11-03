// Reads the text in a picture with Apple's Vision framework and prints it as JSON:
// [{ "text", "conf", "x", "y", "w", "h" }], the box in fractions of the picture with the origin at the TOP left.
//   ocr <png> [languages, comma separated, e.g. "fr-FR,en-US"]
// zdymak compiles this once per version into the temporary folder (see checker.mjs) and never ships a binary.
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count > 1,
      let image = NSImage(contentsOf: URL(fileURLWithPath: args[1])),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot read the picture\n".data(using: .utf8)!)
  exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false // a system dialog's words, read as drawn, not as a dictionary would like them
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
if args.count > 2 {
  let supported = (try? request.supportedRecognitionLanguages()) ?? []
  var langs: [String] = []
  for wanted in args[2].split(separator: ",").map(String.init) {
    let base = wanted.split(separator: "-").first.map(String.init) ?? wanted
    if let hit = supported.first(where: { $0 == wanted }) ?? supported.first(where: { $0 == base || $0.hasPrefix(base + "-") }),
       !langs.contains(hit) {
      langs.append(hit)
    }
  }
  if !langs.isEmpty { request.recognitionLanguages = langs }
}
do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
  exit(3)
}
var out: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let best = observation.topCandidates(1).first else { continue }
  let b = observation.boundingBox
  out.append(["text": best.string, "conf": best.confidence, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: out))
