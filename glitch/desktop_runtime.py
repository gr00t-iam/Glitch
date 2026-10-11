"""Compatibility guard for pywebview 6.1's WebView2 shutdown lifecycle."""

import logging


def install_webview_cleanup_guard(browser_type=None):
    if browser_type is None:
        from webview.platforms.edgechromium import EdgeChrome
        browser_type = EdgeChrome
    if getattr(browser_type, '_glitch_cleanup_guard', False):
        return
    original = browser_type.clear_user_data

    def clear_user_data(browser):
        if getattr(browser, '_glitch_cleanup_complete', False):
            return
        browser._glitch_cleanup_complete = True
        try:
            # WinForms may dispose the child control before FormClosed runs.
            # Do not dereference a missing CoreWebView2 or clean it twice.
            if browser.webview.CoreWebView2 is not None:
                original(browser)
        except Exception:
            # A cleanup error must not escape into a .NET event handler and
            # prevent Application.Exit. Leave failed profile cleanup to Windows.
            logging.getLogger('glitch.desktop').warning(
                'WebView2 was unavailable during profile cleanup; continuing window shutdown.')

    browser_type.clear_user_data = clear_user_data
    browser_type._glitch_cleanup_guard = True
