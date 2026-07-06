#!/usr/bin/env bash
set -euo pipefail

# Instalador principal/orquestrador.
# Mantem os scripts menores independentes para debug manual, mas oferece um
# fluxo unico com mensagens claras de erro e comandos de retomada.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARCHIVE_PATH=""
DRY_RUN="${DRY_RUN:-false}"
RESUME_FROM="${RESUME_FROM:-}"
REPLACE_EXISTING_RELEASE="${REPLACE_EXISTING_RELEASE:-true}"
RUN_HOST_PREPARE="${RUN_HOST_PREPARE:-true}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-true}"
RUN_DOCTOR_ON_FAILURE="${RUN_DOCTOR_ON_FAILURE:-true}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/nodeaccess}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
INSTALL_LOG_FILE="${INSTALL_LOG_FILE:-}"
LOG_STARTED=false

PREPARE_HOST_SCRIPT="${PREPARE_HOST_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/prepare-nodeaccess-host.sh}"
INSTALL_FROM_TARBALL_SCRIPT="${INSTALL_FROM_TARBALL_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/install-from-tarball.sh}"
INSTALL_NODEACCESS_SCRIPT="${INSTALL_NODEACCESS_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/install-nodeaccess.sh}"
SMOKE_CHECK_SCRIPT="${SMOKE_CHECK_SCRIPT:-${PROJECT_ROOT}/scripts/install/smoke-check.sh}"
DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/doctor-nodeaccess.sh}"

usage() {
  cat <<EOF
Uso:
  bash scripts/deploy/install-all-nodeaccess.sh [opcoes]

Opcoes:
  --archive <arquivo.tar.gz>   Extrai/promove uma release antes de instalar.
  --skip-host-prepare          Nao executa prepare-nodeaccess-host.sh.
  --skip-smoke-check           Nao executa smoke-check.sh ao final.
  --dry-run                    Mostra etapas e comandos, sem executar.
  --resume-from <etapa>        Retoma a partir de uma etapa.
  -h, --help                   Mostra esta ajuda.

Etapas validas para --resume-from:
  prepare-host | promote-release | install-stack | smoke-check

Variaveis uteis:
  DRY_RUN=true                 Equivalente a --dry-run.
  RESUME_FROM=install-stack    Equivalente a --resume-from install-stack.
  REPLACE_EXISTING_RELEASE=true
                              Substitui release ja extraida com mesmo nome ao usar --archive.
  RUN_HOST_PREPARE=false       Equivalente a --skip-host-prepare.
  RUN_SMOKE_CHECK=false        Equivalente a --skip-smoke-check.
  RUN_DOCTOR_ON_FAILURE=false  Nao executa doctor-nodeaccess.sh apos falha.
  DEPLOY_ROOT=/opt/nodeaccess  Raiz de deploy para instalacao por pacote.
  ENV_FILE=/caminho/.env       Ambiente usado pelos scripts chamados.
  INSTALL_LOG_FILE=/tmp/install.log
                              Caminho do log persistente. Padrao: DEPLOY_ROOT/shared/logs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      ARCHIVE_PATH="${2:-}"
      if [[ -z "$ARCHIVE_PATH" ]]; then
        echo "Opcao --archive exige o caminho do pacote .tar.gz" >&2
        exit 1
      fi
      shift 2
      ;;
    --skip-host-prepare)
      RUN_HOST_PREPARE=false
      shift
      ;;
    --skip-smoke-check)
      RUN_SMOKE_CHECK=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --resume-from)
      RESUME_FROM="${2:-}"
      if [[ -z "$RESUME_FROM" ]]; then
        echo "Opcao --resume-from exige uma etapa." >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Opcao desconhecida: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

resolve_archive_path() {
  if [[ -z "$ARCHIVE_PATH" ]]; then
    return
  fi

  if [[ "$ARCHIVE_PATH" != /* ]]; then
    ARCHIVE_PATH="$(cd "$PWD" && pwd)/$ARCHIVE_PATH"
  fi

  if [[ ! -f "$ARCHIVE_PATH" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[nodeaccess] Dry-run: pacote ainda nao encontrado, continuando apenas para exibir o plano: $ARCHIVE_PATH"
      return
    fi

    echo "Arquivo da release nao encontrado: $ARCHIVE_PATH" >&2
    exit 1
  fi
}

validate_resume_from() {
  if [[ -z "$RESUME_FROM" ]]; then
    return
  fi

  case "$RESUME_FROM" in
    prepare-host|promote-release|install-stack|smoke-check)
      ;;
    *)
      echo "Etapa invalida para --resume-from: $RESUME_FROM" >&2
      echo "Etapas validas: prepare-host, promote-release, install-stack, smoke-check" >&2
      exit 1
      ;;
  esac
}

should_run_stage() {
  local stage="$1"

  if [[ -z "$RESUME_FROM" ]]; then
    return 0
  fi

  case "$RESUME_FROM" in
    prepare-host)
      return 0
      ;;
    promote-release)
      [[ "$stage" != "prepare-host" ]]
      ;;
    install-stack)
      [[ "$stage" == "install-stack" || "$stage" == "smoke-check" ]]
      ;;
    smoke-check)
      [[ "$stage" == "smoke-check" ]]
      ;;
  esac
}

require_file() {
  local file_path="$1"
  if [[ "$DRY_RUN" == "true" ]]; then
    return
  fi

  [[ -f "$file_path" ]] || {
    echo "Arquivo obrigatorio nao encontrado: $file_path" >&2
    echo "Como corrigir: confira se a release foi extraida corretamente, se o current aponta para a release certa ou se o caminho customizado informado por variavel de ambiente esta correto." >&2
    exit 1
  }
}

setup_logging() {
  if [[ "$LOG_STARTED" == "true" ]]; then
    return
  fi

  if [[ -z "$INSTALL_LOG_FILE" ]]; then
    INSTALL_LOG_FILE="${DEPLOY_ROOT}/shared/logs/install-$(date +%Y%m%d-%H%M%S).log"
  fi

  if ! mkdir -p "$(dirname "$INSTALL_LOG_FILE")" 2>/dev/null || ! touch "$INSTALL_LOG_FILE" 2>/dev/null; then
    echo "[nodeaccess] Nao foi possivel gravar log em $INSTALL_LOG_FILE. Usando /tmp." >&2
    INSTALL_LOG_FILE="/tmp/nodeaccess-install-$(date +%Y%m%d-%H%M%S).log"
    mkdir -p "$(dirname "$INSTALL_LOG_FILE")"
    touch "$INSTALL_LOG_FILE"
  fi

  LOG_STARTED=true

  exec > >(tee -a "$INSTALL_LOG_FILE") 2>&1
}

script_root_for() {
  local script_path="$1"
  local script_dir
  script_dir="$(dirname "$script_path")"

  if cd "${script_dir}/../.." 2>/dev/null; then
    pwd
    return
  fi

  case "$script_dir" in
    */scripts/deploy|*/scripts/install)
      printf "%s\n" "${script_dir%/scripts/*}"
      return
      ;;
  esac

  printf "%s/../..\n" "$script_dir"
}

env_file_for_install_script() {
  if [[ -n "${ENV_FILE:-}" ]]; then
    printf "%s\n" "$ENV_FILE"
    return
  fi

  printf "%s/.env\n" "$(script_root_for "$INSTALL_NODEACCESS_SCRIPT")"
}

print_step_header() {
  local title="$1"
  local what="$2"
  local expected="$3"
  local next_step="$4"
  local manual="$5"

  echo
  echo "================================================================"
  echo "[nodeaccess] Etapa: $title"
  echo "----------------------------------------------------------------"
  echo "O que faz: $what"
  echo "Resultado esperado: $expected"
  echo "Proximo passo: $next_step"
  echo "Debug manual: $manual"
  echo "================================================================"
}

print_failure_help() {
  local title="$1"
  local status="$2"
  local manual="$3"
  local fix_hint="$4"

  echo >&2
  echo "[nodeaccess] ERRO na etapa: $title" >&2
  echo "- codigo de saida: $status" >&2
  echo "- comando para debug manual: $manual" >&2
  echo "- como corrigir: $fix_hint" >&2

  if [[ "$RUN_DOCTOR_ON_FAILURE" == "true" && -f "$DOCTOR_SCRIPT" && "$title" != "Diagnostico da stack" ]]; then
    echo >&2
    echo "[nodeaccess] Executando diagnostico auxiliar. Ele nao corrige automaticamente, apenas aponta causas provaveis." >&2
    if ! ENV_FILE="$(env_file_for_install_script)" bash "$DOCTOR_SCRIPT"; then
      echo "[nodeaccess] doctor-nodeaccess.sh tambem falhou. Rode manualmente: bash $DOCTOR_SCRIPT" >&2
    fi
  fi

  echo >&2
  echo "[nodeaccess] Instalacao interrompida. Corrija a causa acima e reexecute este script ou continue pelo comando manual indicado." >&2
}

run_step() {
  local stage="$1"
  local title="$2"
  local what="$3"
  local expected="$4"
  local next_step="$5"
  local manual="$6"
  local fix_hint="$7"
  shift 7

  if ! should_run_stage "$stage"; then
    echo "[nodeaccess] Etapa ignorada por RESUME_FROM=$RESUME_FROM: $title"
    return
  fi

  print_step_header "$title" "$what" "$expected" "$next_step" "$manual"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[nodeaccess] Dry-run: comando nao executado: $manual"
    return
  fi

  local status=0
  if "$@"; then
    echo "[nodeaccess] Etapa concluida: $title"
    return
  else
    status=$?
  fi

  print_failure_help "$title" "$status" "$manual" "$fix_hint"
  exit "$status"
}

prepare_host() {
  if [[ "$RUN_HOST_PREPARE" != "true" ]]; then
    echo "[nodeaccess] Preparacao do host ignorada por RUN_HOST_PREPARE=false."
    return
  fi

  require_file "$PREPARE_HOST_SCRIPT"

  # Etapa: preparar host
  # O que faz: cria layout de deploy, valida Docker/Compose, portas e disco.
  # Resultado esperado: script termina com codigo 0, podendo emitir alertas.
  # Proximo passo: extrair/promover release ou instalar a release atual.
  run_step \
    "prepare-host" \
    "Preparacao do host" \
    "Cria layout de deploy, valida Docker Compose, portas HTTP/HTTPS e espaco em disco." \
    "prepare-nodeaccess-host.sh termina com codigo 0." \
    "Extrair/promover release ou instalar a release atual." \
    "bash $PREPARE_HOST_SCRIPT" \
    "Instale Docker/Compose, libere permissoes no DEPLOY_ROOT ou corrija portas/disco conforme a mensagem do script." \
    bash "$PREPARE_HOST_SCRIPT"
}

promote_archive_if_needed() {
  if [[ -z "$ARCHIVE_PATH" ]]; then
    return
  fi

  require_file "$INSTALL_FROM_TARBALL_SCRIPT"

  # Etapa: extrair e promover release
  # O que faz: extrai o tarball, carrega imagens offline quando existirem e atualiza current.
  # Resultado esperado: release aparece em releases/ e current aponta para ela.
  # Proximo passo: executar install-nodeaccess.sh da release promovida.
  run_step \
    "promote-release" \
    "Extracao e promocao da release" \
    "Extrai o pacote, carrega imagens offline se existirem e promove a release para current sem iniciar a instalacao interna." \
    "install-from-tarball.sh termina com codigo 0 e current aponta para a release." \
    "Executar install-nodeaccess.sh da release promovida." \
    "RUN_INSTALL=false REPLACE_EXISTING_RELEASE=$REPLACE_EXISTING_RELEASE bash $INSTALL_FROM_TARBALL_SCRIPT $ARCHIVE_PATH" \
    "Confira se o pacote existe, se ha espaco em disco e se o Docker consegue carregar o bundle offline quando presente." \
    env RUN_INSTALL=false REPLACE_EXISTING_RELEASE="$REPLACE_EXISTING_RELEASE" bash "$INSTALL_FROM_TARBALL_SCRIPT" "$ARCHIVE_PATH"

  INSTALL_NODEACCESS_SCRIPT="${CURRENT_LINK}/scripts/deploy/install-nodeaccess.sh"
  SMOKE_CHECK_SCRIPT="${CURRENT_LINK}/scripts/install/smoke-check.sh"
  DOCTOR_SCRIPT="${CURRENT_LINK}/scripts/deploy/doctor-nodeaccess.sh"
}

install_stack() {
  require_file "$INSTALL_NODEACCESS_SCRIPT"

  # Etapa: instalar stack
  # O que faz: valida ambiente, resolve TLS, sobe MySQL/Redis, ajusta auth MySQL,
  # aplica migrations e sobe API, gateway e frontend.
  # Resultado esperado: containers principais sobem sem erro.
  # Proximo passo: executar smoke-check.sh.
  run_step \
    "install-stack" \
    "Instalacao da stack" \
    "Valida .env/compose, prepara TLS, sobe MySQL/Redis, ajusta mysql_native_password, aplica migrations e inicia os servicos." \
    "install-nodeaccess.sh termina com codigo 0 e os containers ficam em execucao." \
    "Executar smoke-check.sh para validar API e gateway." \
    "RUN_SMOKE_CHECK=false bash $INSTALL_NODEACCESS_SCRIPT" \
    "Corrija a mensagem exibida pelo install-nodeaccess.sh. Para debug fino, rode manualmente validate-env.sh, docker compose config, docker compose up -d mysql redis e depois o proprio install-nodeaccess.sh." \
    env RUN_SMOKE_CHECK=false bash "$INSTALL_NODEACCESS_SCRIPT"
}

run_smoke_check() {
  if [[ "$RUN_SMOKE_CHECK" != "true" ]]; then
    echo "[nodeaccess] Smoke check ignorado por RUN_SMOKE_CHECK=false."
    return
  fi

  require_file "$SMOKE_CHECK_SCRIPT"

  # Etapa: validar stack
  # O que faz: consulta os endpoints /health da API e do gateway.
  # Resultado esperado: ambos retornam status ok.
  # Proximo passo: usar a aplicacao e validar login/fluxos principais.
  local effective_env_file
  effective_env_file="$(env_file_for_install_script)"

  run_step \
    "smoke-check" \
    "Smoke check" \
    "Consulta health da API e do gateway para confirmar que a stack responde." \
    "smoke-check.sh termina com codigo 0 e imprime os endpoints validados." \
    "Validar login, hosts e uma sessao SSH pelo navegador." \
    "ENV_FILE=$effective_env_file bash $SMOKE_CHECK_SCRIPT" \
    "Confira APP_URL, TLS/certificados, portas 80/443/3001 e logs dos containers api, ssh-gateway e frontend." \
    env ENV_FILE="$effective_env_file" bash "$SMOKE_CHECK_SCRIPT"
}

main() {
  resolve_archive_path
  validate_resume_from

  echo "[nodeaccess] Instalador principal iniciado."
  echo "- project_root: $PROJECT_ROOT"
  echo "- deploy_root: $DEPLOY_ROOT"
  echo "- archive: ${ARCHIVE_PATH:-<release atual>}"
  echo "- dry_run: $DRY_RUN"
  echo "- resume_from: ${RESUME_FROM:-<inicio>}"
  echo "- replace_existing_release: $REPLACE_EXISTING_RELEASE"
  echo "- run_host_prepare: $RUN_HOST_PREPARE"
  echo "- run_smoke_check: $RUN_SMOKE_CHECK"
  echo "- install_log_file: $INSTALL_LOG_FILE"

  prepare_host
  promote_archive_if_needed
  install_stack
  run_smoke_check

  echo
  echo "[nodeaccess] Instalacao completa concluida."
  echo "- script_instalacao: $INSTALL_NODEACCESS_SCRIPT"
  echo "- smoke_check: $SMOKE_CHECK_SCRIPT"
  echo "- install_log_file: $INSTALL_LOG_FILE"
  echo "- proximo passo: validar login, hosts e uma sessao SSH pelo navegador"
}

setup_logging
main "$@"
