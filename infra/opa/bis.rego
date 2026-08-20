package bis.authz

default allow := false
default reason := "policy denied the request"
default status_code := 403

headers := object.get(input.request, "headers", {})
security_stack := object.get(headers, "x-bis-security-stack", object.get(headers, "X-BIS-Security-Stack", ""))
roles := lower(object.get(headers, "x-bis-user-roles", object.get(headers, "X-BIS-User-Roles", "")))
method := upper(input.request.method)
path := input.request.path

public_path if path == "/health"
public_path if startswith(path, "/api/auth/")
public_path if startswith(path, "/api/oauth/")

authenticated if security_stack == "caddy,open-appsec,apisix"
authenticated if input.type == "bff"
has_admin if contains(roles, "bis-admin")
has_supervisor if contains(roles, "bis-supervisor")
write_method if method == "POST"
write_method if method == "PUT"
write_method if method == "PATCH"
write_method if method == "DELETE"
privileged_path if startswith(path, "/v1/admin/")
privileged_path if startswith(path, "/v1/force-credit/")
requires_mfa if input.action == "force_credit_approve"
requires_mfa if input.action == "caddy_rate_limit_override"
requires_mfa if input.action == "gateway_break_glass"
requires_dual_control if input.action == "caddy_rate_limit_override"
requires_dual_control if input.action == "gateway_break_glass"
has_independent_approver if input.approverId != input.actorId
has_break_glass_reason if count(trim_space(object.get(input, "reason", ""))) >= 10

allow if public_path
allow if {
  authenticated
  not privileged_path
  not write_method
}
allow if {
  authenticated
  not privileged_path
  write_method
  has_admin
}
allow if {
  authenticated
  not privileged_path
  write_method
  has_supervisor
}
allow if {
  authenticated
  privileged_path
  has_admin
  not requires_mfa
}
allow if {
  authenticated
  privileged_path
  has_admin
  requires_mfa
  input.mfaPassed == true
  not requires_dual_control
}
allow if {
  authenticated
  privileged_path
  has_admin
  requires_mfa
  input.mfaPassed == true
  requires_dual_control
  has_independent_approver
  has_break_glass_reason
}

reason := "request bypassed the required Caddy and WAF security stack" if not authenticated
reason := "privileged path requires the BIS administrator role" if {
  authenticated
  privileged_path
  not has_admin
}
reason := "Force Credit approval requires a successful MFA step-up" if {
  authenticated
  privileged_path
  has_admin
  requires_mfa
  input.mfaPassed != true
}
reason := "break-glass requires an independent approver and a detailed reason" if {
  authenticated
  privileged_path
  has_admin
  requires_dual_control
  not has_independent_approver
}
reason := "break-glass requires an independent approver and a detailed reason" if {
  authenticated
  privileged_path
  has_admin
  requires_dual_control
  not has_break_glass_reason
}
reason := "state-changing request requires an administrator or supervisor role" if {
  authenticated
  not privileged_path
  write_method
  not has_admin
  not has_supervisor
}
