use applio_api::ApiConfig;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let code = std::env::var_os("APPLIO_CODE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let data = std::env::var_os("APPLIO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| code.clone());
    let config_dir = std::env::var_os("APPLIO_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| data.join(".applio-dev"));
    let port: u16 = std::env::var("API_PORT")
        .unwrap_or_else(|_| "8000".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("Applio Rust API listening on http://127.0.0.1:{port}");
    let config = ApiConfig {
        code_root: code,
        data_root: data,
        config_dir,
    };
    let stop = CancellationToken::new();
    let environment = applio_api::app_runtime::prepare(
        &config.code_root,
        &config.data_root,
        &config.config_dir,
        false,
        false,
        &[],
    )?;
    let host = applio_api::native_host::serve_with_environment(
        listener,
        config,
        stop.clone(),
        environment,
    );
    tokio::pin!(host);
    let stdin_shutdown = async {
        if !std::env::args().any(|arg| arg == "--shutdown-on-stdin-eof") {
            std::future::pending::<()>().await;
        }
        use tokio::io::AsyncReadExt;
        let mut input = tokio::io::stdin();
        let mut buffer = [0; 256];
        while input.read(&mut buffer).await.is_ok_and(|n| n > 0) {}
    };
    tokio::select! {
        result=&mut host=>return result,
        _=tokio::signal::ctrl_c()=>stop.cancel(),
        _=stdin_shutdown=>stop.cancel(),
    }
    host.await
}
