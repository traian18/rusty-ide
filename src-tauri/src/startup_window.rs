//! Native startup checks must run before the webview's startup coordinator:
//! its splash, errors and retry controls are useless if the window is hidden.
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

// Require usable content and a reachable title bar, not just a corner
// intersecting a display. All coordinates are physical pixels; thresholds
// follow each monitor's scale factor, including mixed-DPI arrangements.
fn accessible(window: Rect, area: Rect, scale: f64) -> bool {
    let minimum_width = (320.0 * scale).ceil() as i64;
    let minimum_height = (200.0 * scale).ceil() as i64;
    let title_width = (160.0 * scale).ceil() as i64;
    let overlap = (window.x + window.width).min(area.x + area.width) - window.x.max(area.x);
    window.width >= minimum_width
        && window.height >= minimum_height
        && window.width <= area.width
        && window.height <= area.height
        && overlap >= title_width
        && window.y >= area.y
        && window.y + minimum_height <= area.y + area.height
}

fn monitor_area(monitor: &tauri::Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: i64::from(area.position.x),
        y: i64::from(area.position.y),
        width: i64::from(area.size.width),
        height: i64::from(area.size.height),
    }
}

fn recover(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_fullscreen(false)?;
    window.unmaximize()?;
    window.unminimize()?;
    let monitor = window
        .primary_monitor()?
        .or_else(|| window.available_monitors().ok()?.into_iter().next());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        // Leave room for native window decorations as well as the Dock/menu.
        let margin = (48.0 * monitor.scale_factor()).ceil() as u32;
        let width = ((800.0 * monitor.scale_factor()) as u32)
            .min(area.size.width.saturating_sub(margin).max(1));
        let height = ((600.0 * monitor.scale_factor()) as u32)
            .min(area.size.height.saturating_sub(margin).max(1));
        window.set_size(PhysicalSize::new(width, height))?;
        let outer = window.outer_size()?;
        window.set_position(PhysicalPosition::new(
            area.position.x + (area.size.width.saturating_sub(outer.width) / 2) as i32,
            area.position.y + (area.size.height.saturating_sub(outer.height) / 2) as i32,
        ))?;
    } else {
        window.set_size(tauri::LogicalSize::new(800.0, 600.0))?;
        window.center()?;
    }
    Ok(())
}

fn check_geometry(window: &WebviewWindow) -> tauri::Result<bool> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let rect = Rect {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: i64::from(size.width),
        height: i64::from(size.height),
    };
    Ok(window
        .available_monitors()?
        .iter()
        .any(|monitor| accessible(rect, monitor_area(monitor), monitor.scale_factor())))
}

pub fn restore_and_show(window: &WebviewWindow, flags: StateFlags) -> tauri::Result<()> {
    let restored = match window.restore_state(flags) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("[startup/window] Could not restore saved window: {error}");
            false
        }
    };
    let usable = match check_geometry(window) {
        Ok(usable) => usable,
        Err(error) => {
            eprintln!("[startup/window] Could not inspect window geometry: {error}");
            false
        }
    };
    if !restored || !usable {
        eprintln!("[startup/window] Recovering window to default size on an available display");
        if let Err(error) = recover(window) {
            // Still attempt to show it: recovery failure must not leave the
            // configured hidden window waiting forever for a page-load event.
            eprintln!("[startup/window] Window recovery failed: {error}");
        }
    }
    window.show()?;
    if let Err(error) = window.set_focus() {
        eprintln!("[startup/window] Could not focus window: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        x: 0,
        y: 25,
        width: 1440,
        height: 850,
    };
    const WINDOW: Rect = Rect {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
    };

    #[test]
    fn preserves_usable_positions_including_partial_horizontal_overlap() {
        assert!(accessible(WINDOW, SCREEN, 1.0));
        assert!(accessible(Rect { x: -600, ..WINDOW }, SCREEN, 1.0));
    }

    #[test]
    fn recovers_disconnected_display_and_unreachable_title_bar() {
        for (x, y) in [
            (2000, 100),
            (100, -100),
            (1430, 100),
            (100, 870),
            (100, 800),
        ] {
            assert!(!accessible(Rect { x, y, ..WINDOW }, SCREEN, 1.0));
        }
    }

    #[test]
    fn recovers_zero_tiny_and_oversized_windows() {
        for (width, height) in [(0, 0), (20, 600), (800, 10), (3000, 600), (800, 2000)] {
            assert!(!accessible(
                Rect {
                    width,
                    height,
                    ..WINDOW
                },
                SCREEN,
                1.0
            ));
        }
    }

    #[test]
    fn supports_negative_monitor_coordinates_and_retina_scaling() {
        let area = Rect {
            x: -2880,
            y: -1800,
            width: 2880,
            height: 1750,
        };
        let window = Rect {
            x: -2700,
            y: -1700,
            width: 1600,
            height: 1200,
        };
        assert!(accessible(window, area, 2.0));
        assert!(!accessible(
            Rect {
                width: 400,
                ..window
            },
            area,
            2.0
        ));
        assert!(!accessible(Rect { x: -100, ..window }, area, 2.0));
    }
}
