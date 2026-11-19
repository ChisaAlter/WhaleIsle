#include <windows.h>
#include <dwmapi.h>
#include <DispatcherQueue.h>
#include <windows.ui.composition.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <memory>

using namespace winrt;
using namespace Windows::UI::Composition;
using namespace Windows::UI::Composition::Desktop;

namespace {
void EnsureDispatcherQueue() {
  if (Windows::System::DispatcherQueue::GetForCurrentThread()) return;
  Windows::System::DispatcherQueueController controller{nullptr};
  DispatcherQueueOptions options{sizeof(options), DQTYPE_THREAD_CURRENT, DQTAT_COM_NONE};
  check_hresult(CreateDispatcherQueueController(options,
      reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(controller))));
  // The Electron UI thread owns this queue for its lifetime, not one window.
  // Retain the controller without running WinRT shutdown under DLL unload.
  detach_abi(controller);
}

struct Backdrop {
  HWND hwnd;
  Compositor compositor;
  DesktopWindowTarget target{nullptr};
  SpriteVisual visual = compositor.CreateSpriteVisual();
  CompositionRoundedRectangleGeometry outline = compositor.CreateRoundedRectangleGeometry();
  bool visible = false;
  LONG width = -1;
  LONG height = -1;
  UINT radius = 0;

  explicit Backdrop(HWND window) : hwnd(window) {
    auto interop = compositor.as<ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>();
    // Below Chromium; no extra HWND, hit-test region, or change to window styles.
    check_hresult(interop->CreateDesktopWindowTarget(hwnd, FALSE,
        reinterpret_cast<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(put_abi(target))));
    visual.Clip(compositor.CreateGeometricClip(outline));
    visual.Brush(compositor.CreateHostBackdropBrush());
  }

  void Update(bool enabled, UINT radiusDip) {
    if (!enabled) {
      if (visible) {
        target.Root(nullptr);
        BOOL hostBackdrop = FALSE;
        check_hresult(DwmSetWindowAttribute(hwnd, DWMWA_USE_HOSTBACKDROPBRUSH, &hostBackdrop, sizeof(hostBackdrop)));
        visible = false;
      }
      return;
    }
    RECT bounds{};
    check_bool(GetClientRect(hwnd, &bounds));
    const UINT dpi = GetDpiForWindow(hwnd);
    if (width != bounds.right || height != bounds.bottom || radius != radiusDip * dpi) {
      width = bounds.right;
      height = bounds.bottom;
      radius = radiusDip * dpi;
      const float scaledRadius = static_cast<float>(radius) / USER_DEFAULT_SCREEN_DPI;
      visual.Size({static_cast<float>(width), static_cast<float>(height)});
      outline.Size(visual.Size());
      outline.CornerRadius({scaledRadius, scaledRadius});
    }
    if (!visible) {
      BOOL hostBackdrop = TRUE;
      check_hresult(DwmSetWindowAttribute(hwnd, DWMWA_USE_HOSTBACKDROPBRUSH, &hostBackdrop, sizeof(hostBackdrop)));
      target.Root(visual);
      visible = true;
    }
  }
};
}

extern "C" __declspec(dllexport) HRESULT CreateWindowAcrylic(HWND hwnd, Backdrop** result) noexcept {
  try {
    EnsureDispatcherQueue();
    *result = std::make_unique<Backdrop>(hwnd).release();
    return S_OK;
  } catch (...) { return to_hresult(); }
}

extern "C" __declspec(dllexport) HRESULT UpdateWindowAcrylic(Backdrop* backdrop, int enabled, UINT radiusDip) noexcept {
  try {
    backdrop->Update(enabled != 0, radiusDip);
    return S_OK;
  } catch (...) { return to_hresult(); }
}

extern "C" __declspec(dllexport) void DestroyWindowAcrylic(Backdrop* backdrop) noexcept {
  delete backdrop;
}
