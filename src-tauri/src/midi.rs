use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// 桌面和 iOS 的命令在 Rust 里用 midir。
/// Android 不注册这些命令，调用会落到 MidiPlugin.kt，从而不链接 libamidi。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::<R>::new("midi");
    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        #![plugin(midi)]
        crate::midi_host::connect,
        crate::midi_host::disconnect,
        crate::midi_host::send
    ]);
    builder
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let _ = app;
                api.register_android_plugin("com.sunbeamhub.xml2jianpu", "MidiPlugin")?;
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
                crate::midi_host::remember_main_thread();
            }
            Ok(())
        })
        .build()
}
