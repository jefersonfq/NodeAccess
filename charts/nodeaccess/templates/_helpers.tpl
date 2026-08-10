{{- define "nodeaccess.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "nodeaccess.fullname" -}}
{{- default (printf "%s-%s" .Release.Name (include "nodeaccess.name" .)) .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "nodeaccess.labels" -}}
app.kubernetes.io/name: {{ include "nodeaccess.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}
{{- define "nodeaccess.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}{{ default (include "nodeaccess.fullname" .) .Values.serviceAccount.name }}{{ else }}{{ .Values.serviceAccount.name }}{{ end }}
{{- end }}
