include(ExternalProject)

# Clones libffi's source once into third_party/libffi. build_libffi() (below)
# is called against this single checkout once or twice - libffi ships no
# CMakeLists.txt upstream, so each call drives its own out-of-tree
# autotools (configure && make) build in a separate BINARY_DIR, rather than
# re-cloning per variant.
function(checkout_libffi)
  set(LIBFFI_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libffi" PARENT_SCOPE)

  if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libffi/configure.ac")
    find_package(Git REQUIRED)
    message("-- Checking out LIBFFI into third_party/libffi")
    execute_process(
      COMMAND "${GIT_EXECUTABLE}" clone --depth 1 --branch v3.4.8
              https://github.com/libffi/libffi.git
              "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libffi"
      RESULT_VARIABLE LIBFFI_CLONE_RESULT)
    if(NOT LIBFFI_CLONE_RESULT EQUAL 0)
      message(FATAL_ERROR "Failed to checkout libffi into third_party/libffi")
    endif(NOT LIBFFI_CLONE_RESULT EQUAL 0)
  endif(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libffi/configure.ac")
endfunction(checkout_libffi)

# build_libffi(<target> [PIC])
#
# Builds one static libffi.a from the shared third_party/libffi checkout,
# via ExternalProject_Add's autotools (configure/make) support - pass PIC
# to compile it with -fPIC (for linking into the quickjs-ffi MODULE), omit
# it for the quickjs-ffi-static STATIC target. Called twice, under two
# different target names, when BUILD_STATIC_MODULE is also set, since one
# build tree can't hold both a -fPIC and a non--fPIC libffi.a at once.
#
# Sets, in the parent scope: <target>_LIBRARY, <target>_INCLUDE_DIR.
macro(build_libffi TARGET)
  cmake_parse_arguments(BUILD_LIBFFI "PIC" "" "" ${ARGN})

  checkout_libffi()

  set(${TARGET}_BINARY_DIR "${CMAKE_CURRENT_BINARY_DIR}/${TARGET}")
  set(${TARGET}_INSTALL_DIR "${${TARGET}_BINARY_DIR}/install")

  if(BUILD_LIBFFI_PIC)
    set(${TARGET}_C_FLAGS "-fPIC")
    message("-- Building LIBFFI from source (${TARGET}, -fPIC)")
  else(BUILD_LIBFFI_PIC)
    set(${TARGET}_C_FLAGS "")
    message("-- Building LIBFFI from source (${TARGET}, no -fPIC)")
  endif(BUILD_LIBFFI_PIC)

  ExternalProject_Add(
    "${TARGET}"
    SOURCE_DIR "${LIBFFI_SOURCE_DIR}"
    BINARY_DIR "${${TARGET}_BINARY_DIR}"
    DOWNLOAD_COMMAND ""
    CONFIGURE_COMMAND
      sh -c "cd '${LIBFFI_SOURCE_DIR}' && test -x configure || ./autogen.sh"
    COMMAND
      "${LIBFFI_SOURCE_DIR}/configure" "--prefix=${${TARGET}_INSTALL_DIR}"
      --disable-shared --enable-static --disable-docs
      "CC=${CMAKE_C_COMPILER}" "CFLAGS=${${TARGET}_C_FLAGS}"
    BUILD_COMMAND make -C "${${TARGET}_BINARY_DIR}"
    INSTALL_COMMAND make -C "${${TARGET}_BINARY_DIR}" install
    BUILD_IN_SOURCE FALSE
    USES_TERMINAL_CONFIGURE ON
    USES_TERMINAL_BUILD ON)

  set(${TARGET}_LIBRARY "${${TARGET}_INSTALL_DIR}/lib/libffi.a")
  set(${TARGET}_INCLUDE_DIR "${${TARGET}_INSTALL_DIR}/include")
endmacro(build_libffi)
