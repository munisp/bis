package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
)

type traceContextKey struct{}

type TraceContext struct {
	TraceID    string
	SpanID     string
	TraceFlags string
	RequestID  string
}

var traceparentPattern = regexp.MustCompile(`^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$`)
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{16,128}$`)

func randomHex(byteLength int) string {
	bytes := make([]byte, byteLength)
	if _, err := rand.Read(bytes); err != nil {
		panic("secure trace identifier generation failed")
	}
	return hex.EncodeToString(bytes)
}

func validNonZeroHex(value string) bool {
	return strings.Trim(value, "0") != ""
}

func newTraceContext(incomingTraceparent, incomingRequestID string) TraceContext {
	traceID, flags := randomHex(16), "01"
	if parsed := traceparentPattern.FindStringSubmatch(strings.ToLower(strings.TrimSpace(incomingTraceparent))); parsed != nil && validNonZeroHex(parsed[1]) && validNonZeroHex(parsed[2]) {
		traceID, flags = parsed[1], parsed[3]
	}
	requestID := strings.TrimSpace(incomingRequestID)
	if !requestIDPattern.MatchString(requestID) {
		requestID = randomHex(16)
	}
	return TraceContext{TraceID: traceID, SpanID: randomHex(8), TraceFlags: flags, RequestID: requestID}
}

func (tc TraceContext) Traceparent() string {
	return "00-" + tc.TraceID + "-" + tc.SpanID + "-" + tc.TraceFlags
}

func traceContextFromRequest(r *http.Request) TraceContext {
	if traceContext, ok := r.Context().Value(traceContextKey{}).(TraceContext); ok {
		return traceContext
	}
	return newTraceContext("", "")
}

func traceCorrelationMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceContext := newTraceContext(r.Header.Get("traceparent"), r.Header.Get("X-Request-ID"))
		w.Header().Set("traceparent", traceContext.Traceparent())
		w.Header().Set("X-Request-ID", traceContext.RequestID)
		r = r.WithContext(context.WithValue(r.Context(), traceContextKey{}, traceContext))
		next.ServeHTTP(w, r)
	})
}

func injectTraceHeaders(req *http.Request, parent TraceContext) {
	child := TraceContext{TraceID: parent.TraceID, SpanID: randomHex(8), TraceFlags: parent.TraceFlags, RequestID: parent.RequestID}
	req.Header.Set("traceparent", child.Traceparent())
	req.Header.Set("X-Request-ID", child.RequestID)
}
