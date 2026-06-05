fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!(
        "cargo:rustc-link-search=native={}/../../deps/lib-dummy-atomics",
        dir
    );
    println!("cargo:rustc-link-lib=static=dummy-atomics");
}