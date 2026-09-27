//! The only lossy numeric conversions in the crate.
//!
//! Rust has no lossless float → integer conversion, so these two use `as`
//! with the range made safe first. Everything else converts with `From` or
//! `try_from`; add a function here rather than a cast anywhere else.

/// A float sample in −1..1 as 16-bit PCM.
#[allow(clippy::cast_possible_truncation)] // clamped to the i16 range first
pub fn pcm16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

/// A non-negative mean of counts back to a count, saturating.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // clamped to the u32 range first
pub fn round_count(value: f64) -> u32 {
    value.round().clamp(0.0, f64::from(u32::MAX)) as u32
}

/// A length as `f64`, exact up to `u32::MAX`, saturating beyond.
pub fn len_f64(len: usize) -> f64 {
    f64::from(u32::try_from(len).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm16_clamps_and_rounds() {
        assert_eq!(pcm16(2.0), i16::MAX);
        assert_eq!(pcm16(-2.0), -i16::MAX);
        assert_eq!(pcm16(0.0), 0);
    }

    #[test]
    fn round_count_saturates() {
        assert_eq!(round_count(-3.0), 0);
        assert_eq!(round_count(2.6), 3);
        assert_eq!(round_count(1e20), u32::MAX);
    }

    #[test]
    fn len_f64_is_exact_for_ordinary_lengths() {
        assert!((len_f64(12_345) - 12_345.0).abs() < f64::EPSILON);
    }
}
