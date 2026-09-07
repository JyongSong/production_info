-- =============================================================
-- 마이그레이션: 기존 production_time 을 UTC → KST 로 보정
--
-- 배경:
--   get_kst_now() 는 2026-07-16 커밋에 도입되었으나, 그 이후 기록된
--   id 32~2032 (2,000건) 이 여전히 UTC 로 저장되어 있다.
--   저장된 시각이 23:00~08:00 에만 분포하는데, +9h 하면 08:00~17:00 로
--   주간 근무 시간과 정확히 일치한다.
--
--   → 해당 커밋이 배포되지 않은 상태에서 기록된 데이터로 판단된다.
--
-- 범위:
--   id <= 2032 로 한정한다. 이 경계는 마이그레이션 작성 시점의 최대 id 이며,
--   이후 새로 저장되는 (이미 KST 인) 기록이 이중 보정되는 것을 막는다.
--
-- 영향:
--   102건은 +9h 로 날짜가 바뀐다 (07-29 의 45건 → 07-30 등).
--   이에 맞춰 shipped_devices 의 batch_id / shipped_date 도 함께 재계산한다.
--
-- 재실행해도 안전하다 (app_settings 에 적용 이력을 남긴다).
-- =============================================================

DO $$
DECLARE
    v_shifted INTEGER;
    v_reshipped INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM app_settings WHERE settings_key = 'migration_002_kst_shift') THEN
        RAISE NOTICE '이미 적용된 마이그레이션입니다. 건너뜁니다.';
        RETURN;
    END IF;

    -- 1. production_time 을 +9시간 보정
    UPDATE production_records
       SET production_time = to_char(
               production_time::TIMESTAMP + INTERVAL '9 hours',
               'YYYY-MM-DD HH24:MI:SS'
           )
     WHERE id <= 2032;
    GET DIAGNOSTICS v_shifted = ROW_COUNT;

    -- 2. deleted_at 도 같은 기준으로 보정 (기록된 경우만)
    UPDATE production_records
       SET deleted_at = to_char(
               deleted_at::TIMESTAMP + INTERVAL '9 hours',
               'YYYY-MM-DD HH24:MI:SS'
           )
     WHERE id <= 2032
       AND deleted_at IS NOT NULL;

    -- 3. 날짜가 바뀐 건에 맞춰 출하 배치 정보 재계산
    UPDATE shipped_devices sd
       SET batch_id = b.batch_id,
           shipped_date = b.shipped_date
      FROM production_records pr
     CROSS JOIN LATERAL _shipped_batch_of(pr.production_time) b
     WHERE sd.record_id = pr.id
       AND pr.id <= 2032
       AND (sd.batch_id IS DISTINCT FROM b.batch_id
            OR sd.shipped_date IS DISTINCT FROM b.shipped_date);
    GET DIAGNOSTICS v_reshipped = ROW_COUNT;

    INSERT INTO app_settings (settings_key, settings_value)
    VALUES ('migration_002_kst_shift',
            to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'));

    RAISE NOTICE '보정 완료: production_records %건, shipped_devices %건 재계산',
        v_shifted, v_reshipped;
END $$;
