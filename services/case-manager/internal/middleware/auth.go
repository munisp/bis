// internal/middleware/auth.go — JWT and stakeholder token middleware
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
)

// JWTAuth validates a Bearer JWT and injects userID and userName into the Gin context.
// The JWT format matches the BIS platform's session cookie payload.
func JWTAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid Authorization header"})
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")

		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			log.Warn().Err(err).Msg("[Auth] Invalid JWT")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			return
		}

		if id, ok := claims["id"]; ok {
			switch v := id.(type) {
			case float64:
				userID := int64(v)
				c.Set("userID", userID)
			}
		}
		if name, ok := claims["name"].(string); ok {
			c.Set("userName", name)
		}
		if email, ok := claims["email"].(string); ok {
			c.Set("userEmail", email)
		}
		if role, ok := claims["role"].(string); ok {
			c.Set("userRole", role)
		}

		c.Next()
	}
}

// StakeholderTokenAuth validates a stakeholder access token passed as a query parameter or header.
// Used for the read-only stakeholder portal — no JWT required.
func StakeholderTokenAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Accept token from query param or Authorization header
		token := c.Query("token")
		if token == "" {
			auth := c.GetHeader("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
		}
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Stakeholder access token required"})
			return
		}
		// In production: look up token in case_stakeholders table, check expiry
		// For now, inject the token so handlers can use it
		c.Set("stakeholderToken", token)
		c.Next()
	}
}

// CORS adds permissive CORS headers for the allowed origins.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	allowed := strings.Join(allowedOrigins, ",")
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		for _, o := range allowedOrigins {
			if o == origin || o == "*" {
				c.Header("Access-Control-Allow-Origin", origin)
				break
			}
		}
		_ = allowed
		c.Header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// RequestLogger logs each incoming request with method, path, status, and latency.
func RequestLogger() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		log.Info().
			Str("method", param.Method).
			Str("path", param.Path).
			Int("status", param.StatusCode).
			Dur("latency", param.Latency).
			Str("ip", param.ClientIP).
			Msg("[CaseManager]")
		return ""
	})
}
