include(ExternalProject)

# Pinned TinyCC commit (mob branch) - upstream has no tag newer than the 2017
# release_0_9_27, which predates much of the x86_64/aarch64 work.
set(LIBTCC_COMMIT 9db1105c32afd3dcf0c28b8186f08e63c761b2b5)

# Fetches TinyCC's source once into third_party/tinycc. build_libtcc() (below)
# is called against this single checkout once or twice, each call driving its
# own out-of-tree configure && make in a separate BINARY_DIR.
function(checkout_libtcc)
  set(LIBTCC_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/tinycc" PARENT_SCOPE)

  if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/tinycc/libtcc.c")
    find_package(Git REQUIRED)
    message("-- Checking out TinyCC into third_party/tinycc")
    set(dir "${CMAKE_CURRENT_SOURCE_DIR}/third_party/tinycc")
    file(MAKE_DIRECTORY "${dir}")
    execute_process(COMMAND "${GIT_EXECUTABLE}" init -q WORKING_DIRECTORY "${dir}" RESULT_VARIABLE r1)
    execute_process(COMMAND "${GIT_EXECUTABLE}" fetch -q --depth 1 https://github.com/TinyCC/tinycc ${LIBTCC_COMMIT}
                    WORKING_DIRECTORY "${dir}" RESULT_VARIABLE r2)
    execute_process(COMMAND "${GIT_EXECUTABLE}" checkout -q FETCH_HEAD WORKING_DIRECTORY "${dir}" RESULT_VARIABLE r3)
    if(NOT (r1 EQUAL 0 AND r2 EQUAL 0 AND r3 EQUAL 0))
      file(REMOVE_RECURSE "${dir}")
      message(FATAL_ERROR "Failed to checkout TinyCC into third_party/tinycc")
    endif()
  endif()
endfunction(checkout_libtcc)

# build_libtcc(<target> [PIC])
#
# Builds a static libtcc.a (plus libtcc1.a and TinyCC's private headers, which
# the in-memory compiler needs at runtime) from the shared third_party/tinycc
# checkout via ExternalProject_Add. Pass PIC to compile with -fPIC (for linking
# into the quickjs-ffi MODULE); omit it for the quickjs-ffi-static target.
#
# Sets, in the parent scope: <target>_LIBRARY, <target>_INCLUDE_DIR,
# <target>_LIB_DIR (TinyCC's runtime directory: libtcc1.a, include/).
macro(build_libtcc TARGET)
  cmake_parse_arguments(BUILD_LIBTCC "PIC" "" "" ${ARGN})

  checkout_libtcc()

  set(${TARGET}_BINARY_DIR "${CMAKE_CURRENT_BINARY_DIR}/${TARGET}")
  set(${TARGET}_INSTALL_DIR "${${TARGET}_BINARY_DIR}/install")

  if(BUILD_LIBTCC_PIC)
    set(${TARGET}_C_FLAGS "-fPIC")
  else()
    set(${TARGET}_C_FLAGS "")
  endif()
  message("-- Building TinyCC from source (${TARGET}, ${${TARGET}_C_FLAGS})")

  ExternalProject_Add(
    "${TARGET}"
    SOURCE_DIR "${LIBTCC_SOURCE_DIR}"
    BINARY_DIR "${${TARGET}_BINARY_DIR}"
    DOWNLOAD_COMMAND ""
    CONFIGURE_COMMAND
      "${LIBTCC_SOURCE_DIR}/configure" "--prefix=${${TARGET}_INSTALL_DIR}"
      "--cc=${CMAKE_C_COMPILER}" "--extra-cflags=${${TARGET}_C_FLAGS}"
      --config-bcheck=no --config-backtrace=no
    BUILD_COMMAND make -C "${${TARGET}_BINARY_DIR}" libtcc.a libtcc1.a
    INSTALL_COMMAND make -C "${${TARGET}_BINARY_DIR}" install
    BUILD_BYPRODUCTS "${${TARGET}_INSTALL_DIR}/lib/libtcc.a"
    USES_TERMINAL_CONFIGURE ON
    USES_TERMINAL_BUILD ON)

  set(${TARGET}_LIBRARY "${${TARGET}_INSTALL_DIR}/lib/libtcc.a")
  set(${TARGET}_INCLUDE_DIR "${${TARGET}_INSTALL_DIR}/include")
  set(${TARGET}_LIB_DIR "${${TARGET}_INSTALL_DIR}/lib/tcc")
endmacro(build_libtcc)
