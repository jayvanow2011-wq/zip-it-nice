use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;

/// Capture a single frame from the default camera and return as base64 JPEG.
pub fn capture_camera_b64(quality: u8) -> Result<String, String> {
    // Try to open the first available camera
    let devices = nokhwa::query(nokhwa::utils::ApiBackend::Auto)
        .map_err(|e| format!("Camera query: {e}"))?;

    if devices.is_empty() {
        return Err("No cameras found".into());
    }

    let idx = nokhwa::utils::CameraIndex::Index(0);
    let req = nokhwa::utils::RequestedFormat::new::<nokhwa::pixel_format::RgbFormat>(
        nokhwa::utils::RequestedFormatType::AbsoluteHighestFrameRate,
    );

    let mut camera = nokhwa::Camera::new(idx, req)
        .map_err(|e| format!("Camera open: {e}"))?;
    camera.open_stream().map_err(|e| format!("Stream: {e}"))?;

    let frame = camera.frame().map_err(|e| format!("Frame: {e}"))?;
    let decoded = frame.decode_image::<nokhwa::pixel_format::RgbFormat>()
        .map_err(|e| format!("Decode: {e}"))?;

    camera.stop_stream().ok();

    let (w, h) = (decoded.width(), decoded.height());
    let mut buf = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    image::ImageEncoder::write_image(
        encoder,
        decoded.as_raw(),
        w,
        h,
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| format!("Encode: {e}"))?;

    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buf.into_inner(),
    ))
}
