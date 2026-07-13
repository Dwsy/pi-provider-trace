from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

BASE = "http://127.0.0.1:32219"
errors = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1, accept_downloads=True)
    page.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(f"page:{error}"))
    page.goto(BASE, wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except PlaywrightTimeout:
        pass  # The expected EventSource connection remains open.
    page.wait_for_selector("#requestList .request-row", timeout=10000)

    assert page.locator("#sessionList .session-row").count() == 2
    assert page.locator("#requestList .request-row").count() == 2
    page.wait_for_function("document.querySelector('#liveStreamOutput')?.textContent.includes('without resending')")
    assert "compact text patch" in page.locator("#liveStreamOutput").inner_text()
    assert page.locator(".sessions-pane").is_visible()
    assert page.locator(".requests-pane").is_visible()
    assert page.locator(".inspector-pane").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth") == 1440
    assert page.evaluate("document.querySelector('#requestList').scrollWidth === document.querySelector('#requestList').clientWidth")
    request_time = page.locator("#requestList .request-foot span").first.inner_text()
    assert "2026-07-11" in request_time and request_time.count(":") >= 2

    session_width = page.locator(".sessions-pane").bounding_box()["width"]
    resize_box = page.locator('[data-resize-pane="sessions"]').bounding_box()
    page.mouse.move(resize_box["x"] + 2, resize_box["y"] + 100)
    page.mouse.down()
    page.mouse.move(resize_box["x"] + 54, resize_box["y"] + 100)
    page.mouse.up()
    assert page.locator(".sessions-pane").bounding_box()["width"] >= session_width + 40

    inspector_width = page.locator(".inspector-pane").bounding_box()["width"]
    page.locator("#toggleSessionsButton").click()
    assert not page.locator(".sessions-pane").is_visible()
    assert page.locator(".inspector-pane").bounding_box()["width"] > inspector_width
    page.locator("#toggleSessionsButton").click()
    assert page.locator(".sessions-pane").is_visible()
    page.evaluate("document.documentElement.dataset.theme = 'dark'")
    page.screenshot(path="/tmp/pi-trace-desktop-dark.png", full_page=True)

    page.locator('[data-tab="payload"]').click()
    assert "gpt-5.2-codex" in page.locator(".code-block").inner_text()
    assert "0.35" in page.locator('[data-parameter="temperature"]').inner_text()
    assert "2500" in page.locator('[data-parameter="max_output_tokens"]').inner_text()
    assert "medium" in page.locator('[data-parameter="reasoning"]').inner_text()
    assert page.locator(".tool-definition").count() == 2
    assert page.locator('[data-tool-definition="read"]').count() == 1
    assert page.locator('[data-tool-definition="web_search_preview"]').count() == 1
    assert "logger persisted every sse_line" in page.locator(".message-tool-event.result").inner_text()
    page.screenshot(path="/tmp/pi-trace-input.png", full_page=True)
    page.locator('[data-tab="timeline"]').click()
    assert page.locator(".timeline-row").count() >= 3
    page.locator('[data-tab="flow"]').click()

    page.locator("#requestList .request-row").nth(1).click()
    assert page.locator(".tool-call").count() == 1
    assert "logger persisted every sse_line" in page.locator(".tool-call .tool-code").nth(1).text_content()
    page.locator('[data-tab="payload"]').click()
    assert "0.2" in page.locator('[data-parameter="temperature"]').inner_text()
    assert page.locator(".tool-definition").count() == 2
    page.locator('[data-tab="flow"]').click()
    page.locator("#requestList .request-row").first.click()

    page.locator("#globalSearch").fill("anthropic")
    page.wait_for_timeout(180)
    assert page.locator("#requestList .request-row").count() == 1
    page.locator("#globalSearch").fill("")
    page.wait_for_timeout(180)

    initial_theme = page.locator("html").get_attribute("data-theme")
    page.locator("#themeButton").click()
    assert page.locator("html").get_attribute("data-theme") != initial_theme
    page.evaluate("document.documentElement.dataset.theme = 'light'")
    page.screenshot(path="/tmp/pi-trace-desktop-light.png", full_page=True)

    narrow = browser.new_page(viewport={"width": 1000, "height": 760}, device_scale_factor=1)
    narrow.goto(BASE, wait_until="domcontentloaded")
    narrow.wait_for_selector("#requestList .request-row", timeout=10000)
    assert narrow.locator(".sessions-pane").is_visible()
    assert narrow.locator(".requests-pane").is_visible()
    assert narrow.locator(".inspector-pane").is_visible()
    assert narrow.evaluate("document.documentElement.scrollWidth") == 1000
    assert narrow.locator(".inspector-pane").bounding_box()["width"] >= 360
    narrow.screenshot(path="/tmp/pi-trace-narrow.png", full_page=True)
    narrow.close()

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: errors.append(f"mobile-console:{message.text}") if message.type == "error" else None)
    mobile.on("pageerror", lambda error: errors.append(f"mobile-page:{error}"))
    mobile.goto(BASE, wait_until="domcontentloaded")
    mobile.wait_for_selector("#requestList .request-row", timeout=10000)
    assert mobile.locator(".requests-pane").is_visible()
    assert not mobile.locator(".sessions-pane").is_visible()
    mobile.locator("#requestList .request-row").first.click()
    assert mobile.locator(".inspector-pane").is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth") == 390
    assert mobile.locator('[data-tab="raw"]').is_visible()
    assert mobile.locator(".inspector-metrics .metric-inline:visible").count() == 1
    mobile.screenshot(path="/tmp/pi-trace-mobile.png", full_page=True)

    mobile.locator('[data-mobile-target="requests"]').click()
    assert mobile.locator(".requests-pane").is_visible()
    mobile.close()

    page.locator("#batchModeButton").click()
    assert page.locator("#sessionBatchActions").is_visible()
    page.locator("#selectAllSessions").click()
    assert page.locator('.session-select[aria-checked="true"]').count() == 2
    assert "2" in page.locator("#batchSelectionLabel").inner_text()
    page.screenshot(path="/tmp/pi-trace-batch.png", full_page=True)
    with page.expect_download() as download_info:
        page.locator("#batchExportSessions").click()
    download = download_info.value
    assert download.suggested_filename == "provider-trace-2-sessions.jsonl"
    exported = Path(download.path()).read_text()
    assert '"sessionKey":"trace-workbench-demo"' in exported
    assert '"sessionKey":"gemini-image-debug"' in exported

    page.locator(".session-select").nth(1).click()
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#batchDeleteSessions").click()
    page.wait_for_function("document.querySelectorAll('#sessionList .session-row').length === 1")
    assert page.locator("#sessionList .session-row").count() == 1
    browser.close()

if errors:
    raise AssertionError("\n".join(errors))

for screenshot in [
    "/tmp/pi-trace-desktop-dark.png",
    "/tmp/pi-trace-desktop-light.png",
    "/tmp/pi-trace-input.png",
    "/tmp/pi-trace-narrow.png",
    "/tmp/pi-trace-mobile.png",
    "/tmp/pi-trace-batch.png",
]:
    assert Path(screenshot).exists(), screenshot

print("ui-visual-test: ok")
