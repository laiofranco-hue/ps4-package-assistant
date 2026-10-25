import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let interfaceURL = URL(string: "http://127.0.0.1:4173/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        webView.loadHTMLString(page("Iniciando o servidor local…"), baseURL: nil)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let started = Self.runScript("start")
            DispatchQueue.main.async {
                guard let self = self else { return }
                if started {
                    self.webView.load(URLRequest(url: self.interfaceURL))
                } else {
                    NSApp.terminate(nil)
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        Self.runScript("stop")
    }

    @objc private func stopServer() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            Self.runScript("stop")
            DispatchQueue.main.async {
                self?.webView.loadHTMLString(self?.page("Servidor de pacotes parado. Feche e abra o app para iniciar de novo.") ?? "", baseURL: nil)
            }
        }
    }

    @discardableResult
    private static func runScript(_ name: String) -> Bool {
        guard let script = Bundle.main.url(forResource: name, withExtension: "sh") else { return false }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [script.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }

    private func buildWindow() {
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = NSColor(calibratedRed: 0.063, green: 0.075, blue: 0.102, alpha: 1)
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 980, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "PS4 Package Assistant"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        let visible = NSScreen.screens[0].visibleFrame
        window.setFrameOrigin(NSPoint(x: visible.midX - window.frame.width / 2, y: visible.midY - window.frame.height / 2))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Ocultar PS4 Package Assistant", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        let stopItem = NSMenuItem(title: "Parar servidor de pacotes", action: #selector(stopServer), keyEquivalent: "")
        stopItem.target = self
        appMenu.addItem(stopItem)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Fechar PS4 Package Assistant", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Editar")
        editMenu.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Janela")
        windowMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Fechar janela", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "PS4 Package Assistant"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.loadHTMLString(page("Não foi possível abrir a interface local. Veja ~/Library/Application Support/PS4 Package Assistant/server.log."), baseURL: nil)
    }

    private func page(_ message: String) -> String {
        """
        <!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>:root{color-scheme:dark}body{margin:0;height:100vh;display:grid;place-items:center;background:#10131a;color:#a6b0c0;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:0 24px;text-align:center}</style>
        </head><body><p>\(message)</p></body></html>
        """
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
