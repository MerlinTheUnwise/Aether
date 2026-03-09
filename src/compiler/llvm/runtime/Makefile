CC ?= clang
AR ?= ar
CFLAGS = -std=c11 -Wall -Wextra -Wpedantic -O2 -fPIC

SRC = aether_runtime.c
OBJ = aether_runtime.o
STATIC_LIB = libaether_runtime.a
SHARED_LIB = libaether_runtime.so

# Windows uses .dll instead of .so
ifeq ($(OS),Windows_NT)
    SHARED_LIB = libaether_runtime.dll
endif

.PHONY: all clean static shared

all: static shared

static: $(STATIC_LIB)

shared: $(SHARED_LIB)

$(OBJ): $(SRC) aether_runtime.h
	$(CC) $(CFLAGS) -c $(SRC) -o $(OBJ)

$(STATIC_LIB): $(OBJ)
	$(AR) rcs $(STATIC_LIB) $(OBJ)

$(SHARED_LIB): $(SRC) aether_runtime.h
	$(CC) $(CFLAGS) -shared $(SRC) -o $(SHARED_LIB)

clean:
	rm -f $(OBJ) $(STATIC_LIB) $(SHARED_LIB) libaether_runtime.dll
