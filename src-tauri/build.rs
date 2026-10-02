fn main() {
    println!("cargo:rerun-if-changed=copilot-oauth.json");
    println!("cargo:rerun-if-env-changed=RUSTY_COPILOT_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
