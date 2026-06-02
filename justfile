default:
    just --list

dev:
    vp run db:migrate:local
    vp run dev

fmt:
    vp run fmt

lint: fmt
    vp run lint

tc: lint
    vp run tc

test: lint
    vp run test

build: test
    vp run build

deploy: build
    vp run deploy

clean:
    fd -u -t d -F node_modules . -X rm -rf
    fd -u -t d -F dist . -X rm -rf
    fd -u -t d -F .tmp . -X rm -rf
    fd -u -t d -F .angular . -X rm -rf
    fd -u -t d -F .wrangler . -X rm -rf
