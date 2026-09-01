use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;

/// Capture the primary screen and return JPEG bytes at the given quality (1-100).
pub fn capture_screen(quality: u8) -> Result<Vec<u8>, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Screen list: {e}"))?;
    let screen = screens.into_iter().next().ok_or("No screens found")?;
    let img = screen.capture().map_err(|e| format!("Capture: {e}"))?;

    let rgba = img.rgba();
    let w = img.width();
    let h = img.height();

    let mut buf = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    image::ImageEncoder::write_image(
        encoder,
        &rgba,
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("Encode: {e}"))?;

    Ok(buf.into_inner())
}

/// Capture and return as base64-encoded JPEG.
pub fn capture_screen_b64(quality: u8) -> Result<String, String> {
    let bytes = capture_screen(quality)?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    ))
}
