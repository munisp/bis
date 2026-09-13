package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTraceCorrelationMiddlewarePreservesValidTraceID(t *testing.T) {
	h := traceCorrelationMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		context := traceContextFromRequest(r)
		if context.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
			t.Fatalf("unexpected trace ID: %s", context.TraceID)
		}
		if context.SpanID == "00f067aa0ba902b7" {
			t.Fatal("inbound parent span must not be reused")
		}
	}))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	req.Header.Set("X-Request-ID", "request_id_123456")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, req)
	if !strings.Contains(response.Header().Get("traceparent"), "4bf92f3577b34da6a3ce929d0e0e4736") {
		t.Fatal("response must propagate trace ID")
	}
	if response.Header().Get("X-Request-ID") != "request_id_123456" {
		t.Fatal("valid request ID must be preserved")
	}
}

func TestTraceCorrelationMiddlewareRejectsInvalidOrZeroTraceID(t *testing.T) {
	var captured TraceContext
	h := traceCorrelationMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { captured = traceContextFromRequest(r) }))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("traceparent", "00-00000000000000000000000000000000-0000000000000000-01")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if len(captured.TraceID) != 32 || !validNonZeroHex(captured.TraceID) {
		t.Fatal("invalid trace context must be replaced with a secure nonzero trace ID")
	}
}

func TestInjectTraceHeadersCreatesChildSpan(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://provider.invalid/check", nil)
	parent := TraceContext{TraceID: "4bf92f3577b34da6a3ce929d0e0e4736", SpanID: "00f067aa0ba902b7", TraceFlags: "01", RequestID: "request_id_123456"}
	injectTraceHeaders(request, parent)
	parts := strings.Split(request.Header.Get("traceparent"), "-")
	if len(parts) != 4 || parts[1] != parent.TraceID || parts[2] == parent.SpanID {
		t.Fatal("outbound propagation must retain trace ID and create a child span")
	}
	if request.Header.Get("X-Request-ID") != parent.RequestID {
		t.Fatal("outbound request ID must be retained")
	}
}
