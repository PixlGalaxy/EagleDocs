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
    $RUN_AS node /app/backend/dist/index.js &
    BACKEND_PID=$!
}

# The backend runs as APP_USER (uid/gid 1000), the same uid as the sandboxes, so
# each can use what the other writes and nothing the backend does on /data runs
# as root. Only this setup runs as root; nginx keeps its own master/worker split.
APP_USER=node
DATA_ROOT=${DATA_ROOT:-/data}

# Owns /data for APP_USER without ever walking, as root, a folder a sandbox can
# write to: a link swapped in mid-walk would let it chown anything in this
# container. The users' folders are fixed one level deep only (their parents
# are ours); older files inside them are reported for the admin to fix.
prepare_data() {
    mkdir -p "$DATA_ROOT/workspaces" "$DATA_ROOT/temp"
    chown -h "$APP_USER:$APP_USER" "$DATA_ROOT" "$DATA_ROOT/workspaces" "$DATA_ROOT/temp"
    for entry in "$DATA_ROOT"/* "$DATA_ROOT"/.[!.]*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        case "$entry" in
            "$DATA_ROOT/workspaces" | "$DATA_ROOT/temp") ;;
            # Only the backend writes here (assets, avatars, keys): safe to walk.
            *) find "$entry" -xdev \( ! -user "$APP_USER" -o ! -group "$APP_USER" \) -exec chown -h "$APP_USER:$APP_USER" {} + ;;
        esac
    done
    for dir in "$DATA_ROOT"/workspaces/* "$DATA_ROOT"/temp/*; do
        [ -d "$dir" ] && [ ! -L "$dir" ] && chown -h "$APP_USER:$APP_USER" "$dir"
    done
    if find "$DATA_ROOT/workspaces" "$DATA_ROOT/temp" -xdev -mindepth 2 ! -user "$APP_USER" -print 2>/dev/null | head -n 1 | grep -q .; then
        log "WARNING: files in $DATA_ROOT/workspaces or $DATA_ROOT/temp are not owned by uid 1000 (left by an older image that ran as root); the sandbox cannot change them. With every StudyHawk container and sandbox stopped, run on the host: chown -R 1000:1000 <your /data folder>"
    fi
}

# Lets APP_USER use the Docker socket through its group, whatever gid the host gave it.
docker_access() {
    sock=${DOCKER_HOST:-unix:///var/run/docker.sock}
    sock=${sock#unix://}
    [ -S "$sock" ] || return 0
    gid=$(stat -c %g "$sock")
    group=$(awk -F: -v gid="$gid" '$3 == gid { print $1; exit }' /etc/group)
    if [ -z "$group" ]; then
        group=dockersock
        addgroup -g "$gid" "$group" 2>/dev/null || { log "WARNING: could not create a group for the Docker socket (gid $gid)"; return 0; }
    fi
    addgroup "$APP_USER" "$group" 2>/dev/null || true
    if [ "$(stat -c %a "$sock" | cut -c2)" -lt 6 ]; then
        log "WARNING: $sock is not group read-write; sandboxes will be off"
    fi
}

if [ "$(id -u)" = 0 ]; then
    prepare_data
    docker_access
    RUN_AS="su-exec $APP_USER"
else
    # Started with --user: the caller set the uid (and --group-add for the Docker socket).
    RUN_AS=""
fi

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
