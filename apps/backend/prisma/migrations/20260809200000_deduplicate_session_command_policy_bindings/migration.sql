-- Remove duplicatas existentes, preservando o registro mais antigo de cada escopo.
DELETE duplicate_binding
FROM `session_command_policy_bindings` duplicate_binding
INNER JOIN `session_command_policy_bindings` preserved_binding
  ON preserved_binding.policy_group_id = duplicate_binding.policy_group_id
  AND preserved_binding.target_type = duplicate_binding.target_type
  AND preserved_binding.target_id <=> duplicate_binding.target_id
  AND preserved_binding.id < duplicate_binding.id;

-- MySQL permite varios NULL em um indice UNIQUE. A chave normalizada garante
-- somente um vinculo global (target_id NULL) por grupo sem alterar o contrato.
ALTER TABLE `session_command_policy_bindings`
  DROP INDEX `session_command_policy_bindings_unique_target`,
  ADD COLUMN `target_key` INT GENERATED ALWAYS AS (COALESCE(`target_id`, 0)) STORED,
  ADD UNIQUE INDEX `session_command_policy_bindings_unique_target`(`policy_group_id`, `target_type`, `target_key`);
