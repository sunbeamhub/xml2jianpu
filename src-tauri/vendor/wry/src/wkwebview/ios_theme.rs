use std::cell::RefCell;

use objc2::{
  define_class, msg_send,
  rc::Retained,
  runtime::{NSObject, ProtocolObject},
  ClassType, DeclaredClass, MainThreadOnly, Message,
};
use objc2_foundation::{ns_string, MainThreadMarker, NSObjectProtocol, NSString, NSUserDefaults};
use objc2_ui_kit::{UIColor, UIUserInterfaceStyle, UIView};
use objc2_web_kit::{WKScriptMessage, WKScriptMessageHandler, WKUserContentController};

use super::WryWebView;

const THEME_PREFERENCE_KEY: &str = "xml2jianpu:theme";
const THEME_HANDLER_NAME: &str = "xml2jianpuTheme";

pub(crate) struct IosThemeHandlerIvars {
  views: RefCell<Option<(Retained<UIView>, Retained<WryWebView>)>>,
}

define_class!(
  #[unsafe(super(NSObject))]
  #[thread_kind = MainThreadOnly]
  #[ivars = IosThemeHandlerIvars]
  pub(crate) struct IosThemeHandler;

  unsafe impl NSObjectProtocol for IosThemeHandler {}

  unsafe impl WKScriptMessageHandler for IosThemeHandler {
    #[unsafe(method(userContentController:didReceiveScriptMessage:))]
    fn did_receive(
      this: &IosThemeHandler,
      _controller: &WKUserContentController,
      msg: &WKScriptMessage,
    ) {
      let Some(theme) = theme_from_message(msg) else {
        return;
      };
      save_theme_preference(&theme);
      let views = this.ivars().views.borrow().clone();
      let Some((ns_view, webview)) = views else {
        return;
      };
      paint(&ns_view, &webview, &theme);
    }
  }
);

impl IosThemeHandler {
  pub fn register(controller: &WKUserContentController, mtm: MainThreadMarker) -> Retained<Self> {
    let handler = mtm.alloc::<Self>().set_ivars(IosThemeHandlerIvars {
      views: RefCell::new(None),
    });
    let handler: Retained<Self> = unsafe { msg_send![super(handler), init] };
    let proto = ProtocolObject::from_ref(&*handler);
    unsafe {
      controller.addScriptMessageHandler_name(proto, ns_string!(THEME_HANDLER_NAME));
    }
    handler
  }

  pub fn bind(&self, ns_view: &UIView, webview: &WryWebView) {
    *self.ivars().views.borrow_mut() = Some((ns_view.retain(), webview.retain()));
  }
}

pub fn apply_stored_or_system(ns_view: &UIView, webview: &WryWebView, is_child: bool) {
  match stored_explicit_dark() {
    Some(is_dark) => paint_color(
      ns_view,
      webview,
      is_child,
      &page_color(is_dark),
      Some(is_dark),
    ),
    None => paint_color(ns_view, webview, is_child, &system_background(), None),
  }
}

pub fn apply_rgb(
  ns_view: &UIView,
  webview: &WryWebView,
  is_child: bool,
  red: u8,
  green: u8,
  blue: u8,
  alpha: u8,
) {
  let color = UIColor::colorWithRed_green_blue_alpha(
    red as f64 / 255.0,
    green as f64 / 255.0,
    blue as f64 / 255.0,
    alpha as f64 / 255.0,
  );
  let dark = u16::from(red) + u16::from(green) + u16::from(blue) < 384;
  paint_color(ns_view, webview, is_child, &color, Some(dark));
}

fn theme_from_message(msg: &WKScriptMessage) -> Option<String> {
  let body = unsafe { msg.body() };
  let text = body.downcast::<NSString>().ok()?;
  let theme = text.to_string();
  if theme == "light" || theme == "dark" || theme == "auto" {
    Some(theme)
  } else {
    None
  }
}

fn save_theme_preference(theme: &str) {
  let defaults = NSUserDefaults::standardUserDefaults();
  let key = NSString::from_str(THEME_PREFERENCE_KEY);
  let value = NSString::from_str(theme);
  unsafe {
    defaults.setObject_forKey(Some(&value), &key);
  }
}

fn stored_explicit_dark() -> Option<bool> {
  let defaults = NSUserDefaults::standardUserDefaults();
  let key = NSString::from_str(THEME_PREFERENCE_KEY);
  match defaults.stringForKey(&key)?.to_string().as_str() {
    "dark" => Some(true),
    "light" => Some(false),
    _ => None,
  }
}

fn page_color(is_dark: bool) -> Retained<UIColor> {
  let (red, green, blue) = if is_dark {
    (17.0, 17.0, 19.0)
  } else {
    (249.0, 249.0, 249.0)
  };
  UIColor::colorWithRed_green_blue_alpha(red / 255.0, green / 255.0, blue / 255.0, 1.0)
}

fn system_background() -> Retained<UIColor> {
  unsafe { msg_send![UIColor::class(), systemBackgroundColor] }
}

fn paint(ns_view: &UIView, webview: &WryWebView, theme: &str) {
  match theme {
    "dark" => paint_color(ns_view, webview, false, &page_color(true), Some(true)),
    "light" => paint_color(ns_view, webview, false, &page_color(false), Some(false)),
    _ => paint_color(ns_view, webview, false, &system_background(), None),
  }
}

fn paint_color(
  ns_view: &UIView,
  webview: &WryWebView,
  is_child: bool,
  color: &UIColor,
  dark: Option<bool>,
) {
  if !is_child {
    ns_view.setBackgroundColor(Some(color));
  }
  webview.setBackgroundColor(Some(color));
  let style = match dark {
    Some(true) => UIUserInterfaceStyle::Dark,
    Some(false) => UIUserInterfaceStyle::Light,
    None => UIUserInterfaceStyle::Unspecified,
  };
  apply_interface_style(ns_view, style);
  unsafe {
    let _: () = msg_send![webview, setOverrideUserInterfaceStyle: style];
  }
}

fn apply_interface_style(anchor: &UIView, style: UIUserInterfaceStyle) {
  let set_style = objc2::sel!(setOverrideUserInterfaceStyle:);
  let update_bar = objc2::sel!(setNeedsStatusBarAppearanceUpdate);
  unsafe {
    if anchor.respondsToSelector(set_style) {
      let _: () = msg_send![anchor, setOverrideUserInterfaceStyle: style];
    }
    let mut current = anchor.nextResponder();
    for _ in 0..12 {
      let Some(responder) = current else {
        break;
      };
      if responder.respondsToSelector(set_style) {
        let _: () = msg_send![&*responder, setOverrideUserInterfaceStyle: style];
      }
      if responder.respondsToSelector(update_bar) {
        let _: () = msg_send![&*responder, setNeedsStatusBarAppearanceUpdate];
      }
      current = responder.nextResponder();
    }
  }
}
