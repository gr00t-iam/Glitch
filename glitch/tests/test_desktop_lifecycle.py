import unittest
from types import SimpleNamespace

from glitch.desktop_runtime import install_webview_cleanup_guard


class DesktopLifecycleTests(unittest.TestCase):
    def browser_type(self):
        class Browser:
            def __init__(self, core):
                self.webview = SimpleNamespace(CoreWebView2=core)
                self.calls = 0

            def clear_user_data(self):
                self.calls += 1
                return self.webview.CoreWebView2.BrowserProcessId
        return Browser

    def test_already_disposed_webview_never_dereferences_missing_core(self):
        browser_type = self.browser_type()
        install_webview_cleanup_guard(browser_type)
        browser = browser_type(None)
        browser.clear_user_data()
        self.assertEqual(browser.calls, 0)

    def test_live_cleanup_runs_only_once(self):
        browser_type = self.browser_type()
        install_webview_cleanup_guard(browser_type)
        install_webview_cleanup_guard(browser_type)
        browser = browser_type(SimpleNamespace(BrowserProcessId=123))
        browser.clear_user_data()
        browser.clear_user_data()
        self.assertEqual(browser.calls, 1)

    def test_browser_exit_during_cleanup_does_not_break_window_close(self):
        browser_type = self.browser_type()
        def failed_cleanup(browser):
            raise RuntimeError('Browser process already exited')
        browser_type.clear_user_data = failed_cleanup
        install_webview_cleanup_guard(browser_type)
        browser = browser_type(SimpleNamespace(BrowserProcessId=123))
        with self.assertLogs('glitch.desktop', level='WARNING'):
            browser.clear_user_data()
