.PHONY: dev build start test test-unit test-integration typecheck lint migrate docker-up docker-down

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test:
	npm test

test-unit:
	npm run test:unit

test-integration:
	npm run test:integration

typecheck:
	npm run typecheck

lint:
	npm run lint

migrate:
	npm run migrate

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f app

helm-lint:
	helm lint helm/hookstream

helm-template:
	helm template hookstream helm/hookstream
