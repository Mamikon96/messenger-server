# chore-spec-details-rules

2026-10-14 — chore spec-details-rules: в спеку `docs/auth-password-spec.md` §5 добавлены правила ошибок валидации тела register/login (неверный тип → `required`; битый JSON и тело не объекта → `400` без `details`; один код на поле), решение BE-D37 (= FE-D40 клиента), уточнён BE-41 (приёмка: `bash scripts/check-memory.sh` ✓; ревью не требуется — только документация)
