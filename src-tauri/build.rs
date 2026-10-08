fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "midi",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "connect",
                    "disconnect",
                    "send",
                    "register_listener",
                    "remove_listener",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
