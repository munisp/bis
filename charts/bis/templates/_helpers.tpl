{{- define "bis.name" -}}bis{{- end -}}
{{- define "bis.labels" -}}
app.kubernetes.io/name: {{ include "bis.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "bis.image" -}}
{{- $repository := required "image repository is required" .repository -}}
{{- $digest := required "an immutable image digest is required" .digest -}}
{{- if not (hasPrefix "sha256:" $digest) -}}{{ fail "image digest must begin with sha256:" }}{{- end -}}
{{ printf "%s@%s" $repository $digest }}
{{- end -}}
