import Foundation

final class TTMLNode {
    enum Content {
        case text(String)
        case child(TTMLNode)
    }

    let name: String
    let attributes: [String: String]
    var contents: [Content] = []

    init(name: String, attributes: [String: String]) {
        self.name = name
        self.attributes = attributes
    }

    var localName: String {
        name.split(separator: ":").last.map(String.init) ?? name
    }

    var children: [TTMLNode] {
        contents.compactMap {
            guard case .child(let node) = $0 else { return nil }
            return node
        }
    }

    func attribute(_ names: String...) -> String? {
        for requestedName in names {
            if let value = attributes[requestedName] {
                return value
            }
            if let match = attributes.first(where: {
                $0.key.split(separator: ":").last.map(String.init)
                    == requestedName
            }) {
                return match.value
            }
        }
        return nil
    }

    func hasRole(_ role: String) -> Bool {
        attributes.contains {
            $0.key.split(separator: ":").last == "role"
                && $0.value == role
        }
    }

    func descendants(where predicate: (TTMLNode) -> Bool) -> [TTMLNode] {
        var result: [TTMLNode] = []
        if predicate(self) {
            result.append(self)
        }
        for child in children {
            result.append(contentsOf: child.descendants(where: predicate))
        }
        return result
    }

    func text(excludingRoles excludedRoles: Set<String> = []) -> String {
        if excludedRoles.contains(where: hasRole) {
            return ""
        }
        return contents.map { content in
            switch content {
            case .text(let text): text
            case .child(let child): child.text(excludingRoles: excludedRoles)
            }
        }.joined()
    }
}

enum TTMLDocument {
    static func parse(_ source: String) -> TTMLNode? {
        guard let data = source.data(using: .utf8) else { return nil }
        let delegate = TTMLDocumentBuilder()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = false
        parser.shouldReportNamespacePrefixes = true
        guard parser.parse() else { return nil }
        return delegate.root
    }
}

private final class TTMLDocumentBuilder: NSObject, XMLParserDelegate {
    private(set) var root: TTMLNode?
    private var stack: [TTMLNode] = []

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        let node = TTMLNode(
            name: qName ?? elementName,
            attributes: attributeDict
        )
        if let parent = stack.last {
            parent.contents.append(.child(node))
        } else {
            root = node
        }
        stack.append(node)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard let node = stack.last else { return }
        if case .text(let existing)? = node.contents.last {
            node.contents[node.contents.count - 1] = .text(existing + string)
        } else {
            node.contents.append(.text(string))
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        _ = stack.popLast()
    }
}

