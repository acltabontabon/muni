//! Prints the OpenAPI document. The frontend's typed client is generated from it.
fn main() {
    println!("{}", muni::openapi().to_pretty_json().expect("openapi json"));
}
