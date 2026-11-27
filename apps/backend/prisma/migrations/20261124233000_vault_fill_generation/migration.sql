-- Global generation: API startup rotates it even with fill disabled.
-- Old pending operations must never become usable again after off/on or restart.
CREATE TABLE vault_fill_generation (
 id TINYINT NOT NULL PRIMARY KEY,
 generation VARCHAR(64) NOT NULL,
 CONSTRAINT vault_fill_generation_singleton CHECK (id = 1)
);
