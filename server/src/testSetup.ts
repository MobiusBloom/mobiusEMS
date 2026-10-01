// Unit tests run without production secrets or a provisioned database.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-for-local-unit-tests-only";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-for-local-unit-tests-only";
