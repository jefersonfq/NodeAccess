#!/usr/bin/env bash
# Source after the compose wrapper has been defined; read-only checks before recreation.
guard_stateful_images() {
  local runner="$1" service container desired tag current target_track current_track oldest native_users
  for service in mysql redis; do
    container="$("$runner" ps -aq "$service")"
    [[ -n "$container" ]] || continue
    if [[ "$service" == mysql ]]; then
      desired="$("$runner" config --images | grep -E '(^mysql:|^nodeaccess-mysql:|/mysql/community-server:)' | head -n 1)"
      current="$(docker exec "$container" mysqld --version | sed -nE 's/.*Ver ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
    else
      desired="$("$runner" config --images | grep -E '(^redis:|^nodeaccess-redis:|/redis:)' | head -n 1)"
      current="$(docker exec "$container" redis-server --version | sed -nE 's/.*v=([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
    fi
    tag="${desired%%@*}"; tag="${tag##*:}"; tag="${tag%%-*}"
    if [[ -z "$current" || ! "$tag" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
      echo "[fail] Nao foi possivel conferir a versao de $service. Mantenha o container anterior disponivel para o preflight." >&2
      return 1
    fi
    # MySQL series upgrades and Redis major upgrades require a restored backup rehearsal.
    current_track="${current%.*}"; target_track="$(printf '%s' "$tag" | cut -d. -f1,2)"
    if [[ "$service" == redis ]]; then current_track="${current%%.*}"; target_track="${tag%%.*}"; fi
    oldest="$(printf '%s\n%s\n' "$current_track" "$target_track" | sort -V | head -n 1)"
    if [[ "$current_track" != "$target_track" && "$oldest" == "$target_track" ]]; then
      echo "[fail] Downgrade de $service ($current -> $tag) sobre o volume atual foi bloqueado. Restaure o backup em OUTRO volume." >&2
      return 1
    fi
    if [[ "$current_track" != "$target_track" && "${STATEFUL_UPGRADE_APPROVED:-false}" != true ]]; then
      echo "[fail] Migracao de $service ($current -> $tag) requer backup restaurado, janela e plano de retorno. Depois do ensaio, use STATEFUL_UPGRADE_APPROVED=true." >&2
      return 1
    fi
    if [[ "$service" == mysql && "$current_track" != "$target_track" ]]; then
      native_users="$(docker exec "$container" sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=socket -uroot -N -B -e "SELECT COUNT(*) FROM mysql.user WHERE plugin=\"mysql_native_password\""')"
      if [[ "$native_users" != 0 ]]; then
        echo "[fail] MySQL ainda possui contas mysql_native_password. Migre as contas para caching_sha2_password no servidor antigo antes do upgrade." >&2
        return 1
      fi
    fi
  done
}
