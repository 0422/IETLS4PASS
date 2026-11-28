// 2026-11-19：启动独立桌面应用，通过 Tauri 命令访问 SQLite。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;
// 2026-11-21：文本模型调用层与练习业务分别维护。
mod llm;

// 2026-11-20：启动时用屏幕工作区和实际窗框尺寸计算窗口高度。
use tauri::{utils::config::WindowConfig, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

fn fit_startup_height(window: &WebviewWindow, config: &WindowConfig) -> tauri::Result<()> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let frame_height = outer.height.saturating_sub(inner.height);
    let height = work_area.size.height.saturating_sub(frame_height);
    if height == 0 {
        return Ok(());
    }

    if let Some(min_height) = config.min_height {
        let minimum = LogicalSize::new(config.min_width.unwrap_or_default(), min_height)
            .to_physical::<u32>(monitor.scale_factor());
        if height < minimum.height {
            window.set_min_size(Some(PhysicalSize::new(minimum.width, height)))?;
        }
    }

    let horizontal_margin = work_area.size.width.saturating_sub(outer.width) / 2;
    let left = work_area.position.x.saturating_add(horizontal_margin as i32);
    window.set_size(PhysicalSize::new(inner.width, height))?;
    window.set_position(PhysicalPosition::new(left, work_area.position.y))?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 2026-11-19：由 Rust 发起题库目录选择及本地 PDF 打开。
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 2026-11-23：供题面图片、静态 JSON 及 Kokoro Worker 读取已绑定的资源。
        .register_asynchronous_uri_scheme_protocol("study-data", |context, request, responder| {
            if context.webview_label() != "main" {
                responder.respond(tauri::http::Response::new(Vec::<u8>::new()));
                return;
            }
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(store::resources::respond(&app, request)));
        })
        .setup(|app| {
            // 2026-11-19：SQLite 启动失败时仍可打开设置与导出内存诊断。
            let database = app.path().app_data_dir().ok()
                .and_then(|directory| store::Database::open(&directory).ok())
                .unwrap_or_else(store::Database::unavailable);
            // 2026-11-21：运行题库从 data 自动登记，迁移原默认目录绑定。
            if let Err(error) = store::bank::bind_default_library(&database) {
                eprintln!("无法登记本地题库目录：{error}");
            }
            app.manage(database);
            // 2026-11-21：独立管理课程笔记文件访问。
            app.manage(store::notes::CourseNotes::default());
            // 2026-11-22：Prompt 文档的编辑和模型读取共享本机文件锁。
            app.manage(store::prompts::PromptDocuments::default());
            // 2026-11-20：先调整高度和顶部位置再显示主窗口，检测失败时仍正常启动。
            if let Some(window) = app.get_webview_window("main") {
                if let Some(config) = app.config().app.windows.iter().find(|config| config.label == "main") {
                    let _ = fit_startup_height(&window, config);
                }
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::list_records,
            store::save_record,
            store::delete_records,
            store::list_documents,
            store::put_document,
            // 2026-11-23：后台事务保存词表删除操作。
            store::remove_vocabulary_words,
            store::delete_document,
            store::export_workspace,
            // 2026-11-23：恢复统一使用后面的预览和确认接口。
            // 2026-11-19：提供恢复管理、数据检查与明确确认后的本机重置。
            store::workspace_info,
            store::reset_workspace,
            // 2026-11-21：设置页管理本机模型连接，密钥仅通过保存命令写入。
            store::ai_models::list_ai_models,
            store::ai_models::save_ai_model,
            store::ai_models::select_ai_model,
            store::ai_models::delete_ai_model,
            // 2026-11-21：注册模型热切换、连接测试与通用文本生成。
            store::ai_models::set_ai_model_variant,
            llm::test_ai_model,
            llm::generate_llm_text,
            // 2026-11-21：口语问答独立保存，录音交给配置的语音转写服务。
            llm::asr::transcribe_speaking_audio,
            store::speaking::save_speaking_session,
            // 2026-11-21：支持按需回放已经发送的作答录音。
            store::speaking::read_speaking_audio,
            // 2026-11-23：注册单篇阅读恢复、中断和复习反馈命令。
            store::reading::open_reading_draft,
            store::reading::save_reading_draft,
            store::reading::apply_review_feedback,
            // 2026-11-19：读取用户选定的题库及其本地资产。
            store::bank::list_bank_folders,
            store::bank::scan_bank_folder,
            store::bank::read_bank_text,
            store::bank::read_bank_media,
            store::bank::open_bank_pdf,
            // 2026-11-23：系统设置管理每种资源的生效位置。
            store::resources::list_resource_directories,
            store::resources::choose_resource_directory,
            store::resources::reset_resource_directory,
            // 2026-11-21：课程笔记通过桌面命令读取和保存 Markdown。
            store::notes::list_course_notes,
            store::notes::read_course_note,
            store::notes::create_course_note,
            store::notes::save_course_note,
            store::notes::delete_course_note,
            // 2026-11-22：Prompt 文档可在独立页面读取和保存。
            store::prompts::list_prompt_documents,
            store::prompts::read_prompt_document,
            store::prompts::save_prompt_document,
            // 2026-11-19：注册备份恢复和本地诊断入口。
            store::backup::preview_workspace_restore,
            store::backup::apply_workspace_restore,
            store::backup::list_workspace_backups,
            store::backup::create_workspace_backup,
            store::backup::read_workspace_backup,
            store::backup::delete_workspace_backup,
            store::diagnostics::record_diagnostic,
            store::diagnostics::diagnostic_report,
            store::diagnostics::configure_diagnostics,
            store::diagnostics::clear_diagnostics,
            // 2026-11-19：保留听力 Section 的续做和原子提交。
            store::listening::save_listening_draft,
            store::listening::commit_listening_section,
        ])
        .run(tauri::generate_context!())
        .expect("IETLS4PASS 无法启动");
}
