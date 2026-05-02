use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// Task execution status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Paused,
    Done,
    Failed,
}

/// Task metadata visible to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    pub id: String,
    pub name: String,
    pub plugin_id: Option<String>,
    pub status: TaskStatus,
    pub progress: f32,
    pub message: Option<String>,
    pub created_at: i64,
}

/// Handle passed into spawned tasks for progress reporting and stop detection.
pub struct TaskContext {
    info: Arc<Mutex<TaskInfo>>,
    stop_rx: watch::Receiver<bool>,
    app: AppHandle,
    task_id: String,
}

impl TaskContext {
    pub fn should_stop(&self) -> bool {
        *self.stop_rx.borrow()
    }

    pub async fn sleep_or_stop(&self, duration: std::time::Duration) -> bool {
        tokio::select! {
            _ = tokio::time::sleep(duration) => false,
            _ = async {
                let mut rx = self.stop_rx.clone();
                loop {
                    if *rx.borrow() {
                        break;
                    }
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            } => true,
        }
    }

    pub fn update_progress(&self, progress: f32, message: Option<String>) {
        let p = progress.clamp(0.0, 1.0);
        {
            let mut info = self.info.lock().unwrap();
            info.progress = p;
            info.message = message.clone();
        }
        let _ = self.app.emit(
            "task-progress",
            serde_json::json!({
                "id": self.task_id,
                "progress": p,
                "message": message,
            }),
        );
    }

    pub fn done(&self) {
        {
            let mut info = self.info.lock().unwrap();
            info.status = TaskStatus::Done;
            info.progress = 1.0;
        }
        let _ = self.app.emit(
            "task-status",
            serde_json::json!({ "id": self.task_id, "status": "done" }),
        );
    }

    pub fn fail(&self, message: &str) {
        {
            let mut info = self.info.lock().unwrap();
            info.status = TaskStatus::Failed;
            info.message = Some(message.to_string());
        }
        let _ = self.app.emit(
            "task-status",
            serde_json::json!({ "id": self.task_id, "status": "failed", "message": message }),
        );
    }
}

struct TaskEntry {
    info: Arc<Mutex<TaskInfo>>,
    join_handle: tokio::task::JoinHandle<()>,
    stop_tx: watch::Sender<bool>,
}

/// Manages background task lifecycle: spawn, cancel, list.
pub struct TaskRuntime {
    tasks: Mutex<HashMap<String, TaskEntry>>,
}

impl TaskRuntime {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a background task. The closure receives a `TaskContext` for
    /// progress reporting and stop-signal detection.
    pub fn spawn<Fut>(
        &self,
        id: String,
        name: String,
        plugin_id: Option<String>,
        app: &AppHandle,
        task_fn: impl FnOnce(TaskContext) -> Fut + Send + 'static,
    ) -> Result<(), String>
    where
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let mut tasks = self.tasks.lock().unwrap();
        if tasks.contains_key(&id) {
            return Err(format!("任务 {id} 已存在"));
        }

        let (stop_tx, stop_rx) = watch::channel(false);
        let now = now_secs();

        let info = Arc::new(Mutex::new(TaskInfo {
            id: id.clone(),
            name,
            plugin_id,
            status: TaskStatus::Running,
            progress: 0.0,
            message: None,
            created_at: now,
        }));

        let ctx = TaskContext {
            info: info.clone(),
            stop_rx,
            app: app.clone(),
            task_id: id.clone(),
        };

        let info_clone = info.clone();
        let join_handle = tokio::spawn(async move {
            task_fn(ctx).await;
            let mut info = info_clone.lock().unwrap();
            if info.status == TaskStatus::Running {
                info.status = TaskStatus::Done;
            }
        });

        let initial_info = info.lock().unwrap().clone();
        let _ = app.emit("task-status", &initial_info);

        tasks.insert(
            id,
            TaskEntry {
                info,
                join_handle,
                stop_tx,
            },
        );

        Ok(())
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock().unwrap();
        let entry = tasks.remove(id).ok_or_else(|| format!("任务 {id} 不存在"))?;
        {
            let mut info = entry.info.lock().unwrap();
            info.status = TaskStatus::Failed;
            info.message = Some("已取消".to_string());
        }
        let _ = entry.stop_tx.send(true);
        entry.join_handle.abort();
        Ok(())
    }

    pub fn list(&self) -> Vec<TaskInfo> {
        self.tasks
            .lock()
            .unwrap()
            .values()
            .map(|e| e.info.lock().unwrap().clone())
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<TaskInfo> {
        self.tasks
            .lock()
            .unwrap()
            .get(id)
            .map(|e| e.info.lock().unwrap().clone())
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_status_serde() {
        let status = TaskStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"running\"");

        let parsed: TaskStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, TaskStatus::Running);
    }

    #[test]
    fn test_task_info_serde() {
        let info = TaskInfo {
            id: "test-1".into(),
            name: "测试任务".into(),
            plugin_id: Some("novel-writer".into()),
            status: TaskStatus::Running,
            progress: 0.5,
            message: Some("进行中".into()),
            created_at: 1700000000,
        };
        let json = serde_json::to_string(&info).unwrap();
        let parsed: TaskInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-1");
        assert_eq!(parsed.status, TaskStatus::Running);
        assert!((parsed.progress - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_task_runtime_new_is_empty() {
        let rt = TaskRuntime::new();
        assert!(rt.list().is_empty());
        assert!(rt.get("nonexistent").is_none());
    }

    #[test]
    fn test_task_runtime_cancel_nonexistent() {
        let rt = TaskRuntime::new();
        assert!(rt.cancel("nope").is_err());
    }
}
