use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

struct Target {
    environment_name: &'static str,
    host: &'static str,
    service: &'static str,
    compose_service: &'static str,
}

fn target(environment: &str, service: &str) -> Option<Target> {
    let (service, compose_service) = match service {
        "server" => ("server", "server"),
        "admin" => ("admin", "admin"),
        "sales-admin" => ("sales-admin", "salesAdmin"),
        _ => return None,
    };
    match (environment, service) {
        ("production", "server") => Some(Target {
            environment_name: "production-server",
            host: "47.236.156.229",
            service,
            compose_service,
        }),
        ("production", "admin") => Some(Target {
            environment_name: "production-admin",
            host: "47.236.156.229",
            service,
            compose_service,
        }),
        ("production", "sales-admin") => Some(Target {
            environment_name: "production-sales-admin",
            host: "47.236.156.229",
            service,
            compose_service,
        }),
        ("staging", "server") => Some(Target {
            environment_name: "staging-server",
            host: "47.101.157.131",
            service,
            compose_service,
        }),
        ("staging", "admin") => Some(Target {
            environment_name: "staging-admin",
            host: "47.101.157.131",
            service,
            compose_service,
        }),
        ("staging", "sales-admin") => Some(Target {
            environment_name: "staging-sales-admin",
            host: "47.101.157.131",
            service,
            compose_service,
        }),
        _ => None,
    }
}

fn parse_runtime(raw: &str, service: &str) -> Result<String, String> {
    let mut fields = raw.split_whitespace();
    let running = fields.next().ok_or("runtime response is empty")?;
    let image = fields.next().ok_or("runtime image is absent")?;
    if running != "true" {
        return Err("service is not running".into());
    }
    if fields.next().is_some() {
        return Err("runtime response has extra fields".into());
    }
    let prefix = format!("ghcr.io/tellyn-ai/tellyn-{service}:");
    let sha = image
        .strip_prefix(&prefix)
        .ok_or("runtime image is not the expected Tellyn service")?;
    if sha.len() != 40 || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("runtime image does not have a full commit SHA tag".into());
    }
    Ok(sha.to_ascii_lowercase())
}

fn classify(runtime_sha: Option<&str>, deployment_sha: Option<&str>) -> &'static str {
    match (runtime_sha, deployment_sha) {
        (Some(runtime), Some(record)) if runtime == record => "verified",
        (Some(_), Some(_)) => "mismatch",
        _ => "unknown",
    }
}

#[derive(Deserialize)]
struct DeploymentRecord {
    id: u64,
    sha: String,
    url: String,
}

#[derive(Deserialize)]
struct DeploymentStatus {
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentEvidence {
    pub environment: String,
    pub service: String,
    pub status: String,
    pub runtime_sha: Option<String>,
    pub deployment_sha: Option<String>,
    pub deployment_url: Option<String>,
    pub runtime_source: String,
    pub reason: Option<String>,
    pub observed_at: u64,
}

fn runtime_image(path: &Path, environment: &str, target: &Target) -> Result<String, String> {
    let format = "'{{.State.Running}} {{.Config.Image}}'";
    let command = if environment == "production" {
        format!("docker inspect --format {format} tellyn-{}", target.service)
    } else {
        format!("cd /opt/tellyn-staging && docker inspect --format {format} \"$(docker compose --env-file .env.staging.local -f stagingCompose.yml ps -q {})\"", target.compose_service)
    };
    let host = format!("root@{}", target.host);
    let raw = crate::github::run(
        path,
        "ssh",
        &[
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=5",
            &host,
            &command,
        ],
    )?;
    parse_runtime(raw.trim(), target.service)
}

fn latest_successful_deployment(
    path: &Path,
    target: &Target,
) -> Result<Option<DeploymentRecord>, String> {
    let endpoint = format!(
        "repos/{{owner}}/{{repo}}/deployments?environment={}&per_page=10",
        target.environment_name
    );
    let raw = crate::github::run(path, "gh", &["api", "-X", "GET", &endpoint])?;
    let records: Vec<DeploymentRecord> =
        serde_json::from_str(&raw).map_err(|_| "invalid deployments response")?;
    for record in records {
        let endpoint = format!(
            "repos/{{owner}}/{{repo}}/deployments/{}/statuses?per_page=1",
            record.id
        );
        let raw = crate::github::run(path, "gh", &["api", "-X", "GET", &endpoint])?;
        let statuses: Vec<DeploymentStatus> =
            serde_json::from_str(&raw).map_err(|_| "invalid deployment statuses response")?;
        if statuses
            .first()
            .is_some_and(|status| status.state == "success")
        {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

pub fn scan_deployment(path: &Path, environment: &str, service: &str) -> DeploymentEvidence {
    let observed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut evidence = DeploymentEvidence {
        environment: environment.into(),
        service: service.into(),
        status: "unknown".into(),
        runtime_sha: None,
        deployment_sha: None,
        deployment_url: None,
        runtime_source: String::new(),
        reason: None,
        observed_at,
    };
    let Some(target) = target(environment, service) else {
        evidence.reason = Some("unsupported environment or service".into());
        return evidence;
    };
    evidence.runtime_source = format!("ssh root@{} docker inspect {}", target.host, target.service);
    let remote = crate::github::run(path, "git", &["remote", "get-url", "origin"]);
    if !matches!(
        remote.as_deref().map(str::trim),
        Ok("git@github.com:tellyn-ai/tellyn.git"
            | "https://github.com/tellyn-ai/tellyn.git"
            | "https://github.com/tellyn-ai/tellyn")
    ) {
        evidence.reason = Some("project is not the configured Tellyn repository".into());
        return evidence;
    }
    let runtime = runtime_image(path, environment, &target);
    let record = latest_successful_deployment(path, &target);
    if let Ok(sha) = &runtime {
        evidence.runtime_sha = Some(sha.clone());
    }
    if let Ok(Some(record)) = &record {
        evidence.deployment_sha = Some(record.sha.clone());
        evidence.deployment_url = Some(record.url.clone());
    }
    evidence.status = classify(
        evidence.runtime_sha.as_deref(),
        evidence.deployment_sha.as_deref(),
    )
    .into();
    if evidence.status != "verified" {
        evidence.reason = Some(match (runtime.err(), record.err()) {
            (Some(error), _) => error,
            (_, Some(error)) => error,
            _ if evidence.status == "mismatch" => {
                "runtime SHA differs from latest successful deployment".into()
            }
            _ => "no successful deployment record found".into(),
        });
    }
    evidence
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn requires_full_running_sha_from_a_running_service() {
        assert_eq!(
            parse_runtime(
                &format!("true ghcr.io/tellyn-ai/tellyn-server:{SHA_A}"),
                "server"
            )
            .unwrap(),
            SHA_A
        );
        assert!(parse_runtime("false ghcr.io/tellyn-ai/tellyn-server:aaaaaaaa", "server").is_err());
        assert!(parse_runtime("true ghcr.io/tellyn-ai/tellyn-server:aaaaaaa", "server").is_err());
        assert!(parse_runtime(
            &format!("true ghcr.io/tellyn-ai/tellyn-admin:{SHA_A}"),
            "server"
        )
        .is_err());
    }

    #[test]
    fn only_matching_successful_deployment_is_verified() {
        assert_eq!(classify(Some(SHA_A), Some(SHA_A)), "verified");
        assert_eq!(classify(Some(SHA_A), Some(SHA_B)), "mismatch");
        assert_eq!(classify(Some(SHA_A), None), "unknown");
        assert_eq!(classify(None, Some(SHA_A)), "unknown");
    }

    #[test]
    fn rejects_targets_outside_tellyn_service_matrix() {
        assert!(target("production", "server").is_some());
        assert!(target("staging", "sales-admin").is_some());
        assert!(target("production", "mobile").is_none());
        assert!(target("preview", "server").is_none());
    }
}
