{{- define "openiotwx.image" -}}
{{ .root.Values.app.registry }}/{{ .image }}
{{- end -}}
{{- define "openiotwx.dburl" -}}
postgresql://{{ .Values.postgres.user }}:$(DB_PASSWORD)@postgres:5432/{{ .Values.postgres.db }}
{{- end -}}
