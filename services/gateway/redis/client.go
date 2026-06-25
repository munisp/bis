package redis

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

var rdb *redis.Client

// Init creates the Redis client. Call once at startup.
func Init() {
	addr := os.Getenv("REDIS_URL")
	if addr == "" {
		addr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     os.Getenv("REDIS_PASSWORD"),
		DB:           0,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[Redis] Warning: cannot connect to %s: %v (continuing without cache)", addr, err)
		rdb = nil
		return
	}
	log.Printf("[Redis] Connected → %s", addr)
}

// RateLimit checks and increments a sliding-window counter for the given key.
// Returns (allowed bool, remaining int, resetIn time.Duration).
func RateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Duration) {
	if rdb == nil {
		return true, limit, window // fail-open if Redis is down
	}
	pipe := rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return true, limit, window
	}
	count := int(incr.Val())
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return count <= limit, remaining, window
}

// CacheGet returns the cached value for key, or ("", false) on miss/error.
func CacheGet(ctx context.Context, key string) (string, bool) {
	if rdb == nil {
		return "", false
	}
	val, err := rdb.Get(ctx, key).Result()
	if err == redis.Nil || err != nil {
		return "", false
	}
	return val, true
}

// CacheSet stores value under key with the given TTL.
func CacheSet(ctx context.Context, key string, value string, ttl time.Duration) {
	if rdb == nil {
		return
	}
	if err := rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		log.Printf("[Redis] CacheSet error for %s: %v", key, err)
	}
}

// CacheDel removes a key.
func CacheDel(ctx context.Context, key string) {
	if rdb == nil {
		return
	}
	rdb.Del(ctx, key)
}

// SessionSet stores a session payload under "session:<token>".
func SessionSet(ctx context.Context, token string, payload string, ttl time.Duration) {
	CacheSet(ctx, fmt.Sprintf("session:%s", token), payload, ttl)
}

// SessionGet retrieves a session payload.
func SessionGet(ctx context.Context, token string) (string, bool) {
	return CacheGet(ctx, fmt.Sprintf("session:%s", token))
}

// SessionDel invalidates a session.
func SessionDel(ctx context.Context, token string) {
	CacheDel(ctx, fmt.Sprintf("session:%s", token))
}

// Close closes the Redis client gracefully.
func Close() {
	if rdb != nil {
		if err := rdb.Close(); err != nil {
			log.Printf("[Redis] Error closing client: %v", err)
		}
	}
}

// ─── Struct wrapper for dependency injection ──────────────────────────────────

// Client is a thin wrapper around the package-level Redis functions.
// Use NewClient to create one; it also calls Init().
type Client struct{}

// NewClient initialises the Redis connection and returns a Client.
func NewClient(addr, password string) (*Client, error) {
	if addr != "" {
		os.Setenv("REDIS_URL", addr)
	}
	if password != "" {
		os.Setenv("REDIS_PASSWORD", password)
	}
	Init()
	return &Client{}, nil
}

// Get retrieves a value by key.
func (c *Client) Get(ctx context.Context, key string) (string, error) {
	val, ok := CacheGet(ctx, key)
	if !ok {
		return "", fmt.Errorf("key not found: %s", key)
	}
	return val, nil
}

// Set stores a value with TTL.
func (c *Client) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	CacheSet(ctx, key, value, ttl)
	return nil
}

// Del removes a key.
func (c *Client) Del(ctx context.Context, key string) error {
	CacheDel(ctx, key)
	return nil
}

// LPush prepends a value to a Redis list (used by DLQ).
func (c *Client) LPush(key, value string) error {
	if rdb == nil {
		return fmt.Errorf("redis not connected")
	}
	return rdb.LPush(context.Background(), key, value).Err()
}

// RPop removes and returns the last element of a Redis list (used by DLQ replay).
func (c *Client) RPop(key string) (string, error) {
	if rdb == nil {
		return "", fmt.Errorf("redis not connected")
	}
	val, err := rdb.RPop(context.Background(), key).Result()
	if err == redis.Nil {
		return "", nil
	}
	return val, err
}
