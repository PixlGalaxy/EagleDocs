#!/bin/sh
set -u

# Each service respawns on its own about 2s after exiting. A crash loop is
# still fatal to the container: more than MAX_RESTARTS exits within
# WINDOW_SECONDS for either service means something is actually broken, and
# the whole container goes down so Docker (or the orchestrator) can react.
# A backend that cannot reach Postgres at boot exits and is retried here too.
MAX_RESTARTS=8
WINDOW_SECONDS=60

# Also tailed by the backend into Admin -> Logs as the ENTRYPOINT channel.
ENTRYPOINT_LOG=/tmp/entrypoint.log

log() {
    echo "[ENTRYPOINT] $*"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$ENTRYPOINT_LOG"
}

start_frontend() {
    # awk with fflush works on busybox too, unlike `sed -u`.
    nginx -g 'daemon off;' 2>&1 | awk '{ print "[FRONTEND] " $0; fflush() }' &
    FRONTEND_PID=$!
}

start_backend() {
    node /app/backend/dist/index.js &
    BACKEND_PID=$!
}

log "Container starting (image ${APP_IMAGE_REF:-dev}${APP_IMAGE_REVISION:+, commit $APP_IMAGE_REVISION})"
start_frontend
start_backend
log "nginx and backend started"

frontend_restarts=0
backend_restarts=0
window_start=$(date +%s)

# POSIX sh has no `wait -n`, so poll both children instead.
while true; do
    sleep 2

    now=$(date +%s)
    if [ $((now - window_start)) -gt "$WINDOW_SECONDS" ]; then
        window_start=$now
        frontend_restarts=0
        backend_restarts=0
    fi

    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        frontend_restarts=$((frontend_restarts + 1))
        if [ "$frontend_restarts" -gt "$MAX_RESTARTS" ]; then
            log "nginx is crash-looping, shutting down the container"
            kill "$BACKEND_PID" 2>/dev/null || true
            exit 1
        fi
        log "nginx exited, restarting (${frontend_restarts}/${MAX_RESTARTS} in ${WINDOW_SECONDS}s)"
        start_frontend
    fi

    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        wait "$BACKEND_PID" 2>/dev/null
        code=$?
        backend_restarts=$((backend_restarts + 1))
        if [ "$backend_restarts" -gt "$MAX_RESTARTS" ]; then
            log "backend is crash-looping (last exit code $code), shutting down the container"
            kill "$FRONTEND_PID" 2>/dev/null || true
            exit 1
        fi
        log "backend exited with code $code, restarting (${backend_restarts}/${MAX_RESTARTS} in ${WINDOW_SECONDS}s)"
        start_backend
    fi
done
