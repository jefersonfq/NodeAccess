-- Encerrar sessoes ao vivo antigas/expiradas.
--
-- Uso sugerido:
--   mysql -h 127.0.0.1 -P 3306 -uUSER -p DB < scripts/maintenance/close-expired-shared-sessions.sql
--
-- Parametros:
--   @tenant_id: defina um tenant especifico ou deixe NULL para todos.
--   @max_age_minutes: encerra links ACTIVE criados ha mais de X minutos.
--                     mantenha NULL para encerrar apenas links com expires_at vencido.

SET @tenant_id = NULL;
SET @max_age_minutes = NULL;

UPDATE shared_session_control_leases sscl
INNER JOIN shared_sessions ss ON ss.id = sscl.shared_session_id
SET
  sscl.ended_at = NOW(),
  sscl.end_reason = 'SESSION_ENDED',
  sscl.revoke_reason = 'maintenance_close_expired_shared_sessions'
WHERE sscl.ended_at IS NULL
  AND ss.status = 'ACTIVE'
  AND (@tenant_id IS NULL OR ss.tenant_id = @tenant_id)
  AND (
    ss.expires_at <= NOW()
    OR (@max_age_minutes IS NOT NULL AND ss.created_at <= DATE_SUB(NOW(), INTERVAL @max_age_minutes MINUTE))
  );

UPDATE shared_session_participants ssp
INNER JOIN shared_sessions ss ON ss.id = ssp.shared_session_id
SET
  ssp.left_at = COALESCE(ssp.left_at, NOW()),
  ssp.last_seen_at = NOW()
WHERE ss.status = 'ACTIVE'
  AND (@tenant_id IS NULL OR ss.tenant_id = @tenant_id)
  AND (
    ss.expires_at <= NOW()
    OR (@max_age_minutes IS NOT NULL AND ss.created_at <= DATE_SUB(NOW(), INTERVAL @max_age_minutes MINUTE))
  );

UPDATE shared_sessions
SET
  status = 'ENDED',
  updated_at = NOW()
WHERE status = 'ACTIVE'
  AND (@tenant_id IS NULL OR tenant_id = @tenant_id)
  AND (
    expires_at <= NOW()
    OR (@max_age_minutes IS NOT NULL AND created_at <= DATE_SUB(NOW(), INTERVAL @max_age_minutes MINUTE))
  );

SELECT ROW_COUNT() AS closed_shared_sessions;
