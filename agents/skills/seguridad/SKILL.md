---
name: auditoria-seguridad
description: Revisa el código fuente, dependencias y configuraciones de la aplicación para identificar vulnerabilidades de seguridad (OWASP Top 10, exposición de secretos y fallos de control de acceso) y proponer correcciones defensivas.
---

# Auditoría de Seguridad de la Aplicación

Cuando el usuario solicite revisar la seguridad de la aplicación o buscar puntos vulnerables, ejecuta este flujo de auditoría de solo lectura y remediación defensiva:

## Fase 1: Reconocimiento y Arquitectura
1. **Identificación del stack:** Revisa los archivos de manifiesto (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Dockerfile`, etc.) para determinar lenguajes, frameworks y dependencias.
2. **Mapeo de superficie de ataque:** Localiza los puntos de entrada de datos externos (rutas API, controladores, formularios, webhooks y consultas a bases de datos).

## Fase 2: Revisión Estática del Código (SAST manual)
Analiza los archivos fuente buscando los siguientes patrones de riesgo:
- **Inyecciones (SQL, NoSQL, Comandos):** Concatenación directa de entradas del usuario en consultas SQL o funciones de ejecución del sistema (`exec`, `eval`, `subprocess` sin sanitizar).
- **Control de Acceso Roto (IDOR / BOLA):** Endpoints que reciben un ID de recurso pero no verifican si el usuario autenticado tiene permisos sobre ese registro.
- **Autenticación y Sesiones:** Manejo débil de contraseñas, tokens JWT sin verificación de firma o expiración, y cookies sin atributos `HttpOnly` o `Secure`.
- **Exposición de Secretos:** Claves API, contraseñas o tokens codificados directamente (*hardcoded*) en el repositorio o archivos `.env` rastreados por Git.
- **XSS y CSRF:** Renderizado de HTML sin escapar (`dangerouslySetInnerHTML`, `innerHTML`) y ausencia de protección contra falsificación de peticiones en formularios sensibles.
- **Configuración Insegura:** Reglas CORS demasiado permisivas (`*`), modos de depuración (`DEBUG=True`) activos o encabezados de seguridad faltantes.

## Fase 3: Análisis Automatizado (Opcional)
Si el entorno cuenta con herramientas instaladas y el usuario aprueba el comando, ejecuta escáneres defensivos locales como:
- `npm audit` / `pip-audit` / `govulncheck` (para dependencias vulnerables).
- `semgrep --config=auto` o `gitleaks detect` (si están disponibles en la terminal).

## Fase 4: Formato del Informe
Entrega los hallazgos ordenados por **Severidad (Crítica, Alta, Media, Baja)** en un Artefacto o respuesta estructurada que incluya para cada vulnerabilidad:
1. **Vulnerabilidad y Categoría:** (ej. *Inyección SQL - OWASP A03*).
2. **Ubicación exacta:** Archivo y número de línea.
3. **Explicación del riesgo:** Cómo afecta a la aplicación si un atacante envía datos maliciosos.
4. **Remediación recomendada:** Fragmento de código seguro para corregir el problema.
