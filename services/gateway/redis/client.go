package redis

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// ErrUnavailable indicates an operation cannot rely on Redis. Protected callers
// must map this to a dependency-unavailable response rather than allow a bypass.
var ErrUnavailable = errors.New("redis unavailable")

// Client owns one checked Redis connection and has no package-global fallback.
type Client struct {
	client *goredis.Client
}

// NewClient requires an explicit address and confirms connectivity before
// returning. It never defaults to a local development server.
func NewClient(addr, password string) (*Client, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return nil, fmt.Errorf("%w: REDIS_ADDR is required", ErrUnavailable)
	}
	client := goredis.NewClient(&goredis.Options{
		Addr:         addr,
		Password:     password,
		DB:           0,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return &Client{client: client}, nil
}

func (c *Client) available() error {
	if c == nil || c.client == nil {
		return ErrUnavailable
	}
	return nil
}

// RateLimit atomically increments a rate counter. Any unavailable backend
// returns an error so sensitive routes may fail closed with HTTP 503.
func (c *Client) RateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Duration, error) {
	if err := c.available(); err != nil {
		return false, 0, 0, err
	}
	if strings.TrimSpace(key) == "" || limit <= 0 || window <= 0 {
		return false, 0, 0, fmt.Errorf("invalid rate limit input")
	}
	pipe := c.client.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, 0, 0, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	count := int(incr.Val())
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return count <= limit, remaining, window, nil
}

// Get returns redis.Nil on a cache miss and ErrUnavailable only when the client
// cannot be relied upon. Callers may treat a miss differently from an outage.
func (c *Client) Get(ctx context.Context, key string) (string, error) {
	if err := c.available(); err != nil {
		return "", err
	}
	value, err := c.client.Get(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", goredis.Nil
	}
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return value, nil
}

func (c *Client) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	if err := c.available(); err != nil {
		return err
	}
	if err := c.client.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

func (c *Client) Del(ctx context.Context, key string) error {
	if err := c.available(); err != nil {
		return err
	}
	if err := c.client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

func (c *Client) LPush(key, value string) error {
	if err := c.available(); err != nil {
		return err
	}
	if err := c.client.LPush(context.Background(), key, value).Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

func (c *Client) RPop(key string) (string, error) {
	if err := c.available(); err != nil {
		return "", err
	}
	value, err := c.client.RPop(context.Background(), key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return value, nil
}

func (c *Client) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}
