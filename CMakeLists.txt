cmake_minimum_required(VERSION 3.5)
project(qjs-ffi VERSION 0.9 LANGUAGES C)

set(BUILD_LIBFFI AUTO CACHE STRING "Build libffi from source (checked out into third_party/libffi): ON always, AUTO when no system libffi is found, OFF never")
set_property(CACHE BUILD_LIBFFI PROPERTY STRINGS ON OFF AUTO)
option(ENABLE_TCC "Checkout TinyCC into third_party/tinycc, build libtcc from source and export cc() (in-memory C compiler) from the ffi module" OFF)

message("Building project [1;31m${PROJECT_NAME}[0m")

set(DISABLE_WERROR ON)

include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/UseMultiArch.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/Functions.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/Compat.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/FindQuickJS.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/QuickJSModule.cmake)
quickjs_module_options(SHARED_DEFAULT ON STATIC_DEFAULT OFF)

if(NOT PKG_CONFIG_FOUND)
  include(FindPkgConfig)
endif(NOT PKG_CONFIG_FOUND)

# LIBFFI_BUILD: whether libffi is built from source. ON forces it, OFF never
# does, AUTO does only when the system has no libffi.
string(TOUPPER "${BUILD_LIBFFI}" _libffi_mode)

if(NOT "${_libffi_mode}" STREQUAL "AUTO")
  if(_libffi_mode)
    set(_libffi_mode ON)
  else(_libffi_mode)
    set(_libffi_mode OFF)
  endif(_libffi_mode)
endif(NOT "${_libffi_mode}" STREQUAL "AUTO")

set(LIBFFI_BUILD FALSE)

if("${_libffi_mode}" STREQUAL "ON")
  set(LIBFFI_BUILD TRUE)
else("${_libffi_mode}" STREQUAL "ON")
  pkg_search_module(LIBFFI libffi)

  if(pkgcfg_lib_LIBFFI_ffi)
    set(LIBFFI_LIBRARY ${pkgcfg_lib_LIBFFI_ffi})
  endif(pkgcfg_lib_LIBFFI_ffi)

  if(NOT LIBFFI_FOUND)
    find_library(LIBFFI_LIBRARY ffi)
  endif(NOT LIBFFI_FOUND)

  if("${_libffi_mode}" STREQUAL "AUTO" AND NOT LIBFFI_FOUND AND NOT LIBFFI_LIBRARY)
    message(STATUS "No system libffi found, building it from source (BUILD_LIBFFI=AUTO)")
    set(LIBFFI_BUILD TRUE)
  endif("${_libffi_mode}" STREQUAL "AUTO" AND NOT LIBFFI_FOUND AND NOT LIBFFI_LIBRARY)
endif("${_libffi_mode}" STREQUAL "ON")

if(LIBFFI_BUILD)
  # quickjs-ffi (MODULE, needs -fPIC code) always gets the PIC build;
  # quickjs-ffi-static gets its own non--fPIC build further down, once
  # BUILD_STATIC's target exists to link it into.
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildLibFFI.cmake)
  build_libffi(libffi-shared PIC)
  set(LIBFFI_LIBRARY "${libffi-shared_LIBRARY}")
  set(LIBFFI_INCLUDE_DIR "${libffi-shared_INCLUDE_DIR}")
  include_directories("${LIBFFI_INCLUDE_DIR}")
  set(FFI_FOUND TRUE)
endif(LIBFFI_BUILD)

if(ENABLE_TCC)
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildLibTCC.cmake)
  build_libtcc(libtcc-shared PIC)
  include_directories("${libtcc-shared_INCLUDE_DIR}")
endif(ENABLE_TCC)

find_library(LIBDL dl)

if(LIBDL)
  link_libraries(${LIBDL})
endif(LIBDL)

if(EXISTS "${LIBFFI_INCLUDE_DIR}")
  include_directories("${LIBFFI_INCLUDE_DIR}")
endif(EXISTS "${LIBFFI_INCLUDE_DIR}")

if(LIBFFI_LIBRARY)
  message(STATUS "Found LIBFFI_LIBRARY at ${LIBFFI_LIBRARY}")
  set(FFI_FOUND TRUE)
endif(LIBFFI_LIBRARY)

find_quickjs()
configure_quickjs()

include_directories(${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/..
                    ${CMAKE_CURRENT_SOURCE_DIR}/../..)
if(CMAKE_SYSTEM_INCLUDE_PATH)
  include_directories(${CMAKE_SYSTEM_INCLUDE_PATH})
endif(CMAKE_SYSTEM_INCLUDE_PATH)

set(DISABLE_WERROR TRUE)

file(GLOB JS_BINDINGS_SOURCES *.[ch])

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(CheckLibraryExists)

if(NOT PKG_CONFIG_FOUND)
  include(FindPkgConfig)
endif(NOT PKG_CONFIG_FOUND)
if(NOT FFI_FOUND)
  pkg_search_module(FFI libffi)

  if(pkgcfg_lib_FFI_ffi)
    set(LIBFFI_LIBRARY "${pkgcfg_lib_FFI_ffi}")
    set(FFI_FOUND TRUE)
  endif(pkgcfg_lib_FFI_ffi)
endif(NOT FFI_FOUND)

if(FFI_FOUND)
  set(HAVE_LIBFFI TRUE)
endif(FFI_FOUND)
# check_library_exists(ffi ffi_call "" HAVE_LIBFFI)

# Main: qjs-ffi (ffi.so, BUILD_SHARED) and qjs-ffi-static (quickjs-ffi.a plus
# quickjs-ffi.module.cmake, BUILD_STATIC) from make_module(); the shared module is linked to
# a -fPIC libffi (libtcc), the static one to its own non-PIC build.
set(ffi_LIBRARIES_shared ${FFI_LIBRARIES} ${LIBFFI_LIBRARY})
set(ffi_LIBRARIES_static ${FFI_LIBRARIES} ${LIBFFI_LIBRARY})

if(LIBFFI_BUILD AND BUILD_STATIC)
  build_libffi(libffi-static)
  set(ffi_LIBRARIES_static ${FFI_LIBRARIES} ${libffi-static_LIBRARY})
endif(LIBFFI_BUILD AND BUILD_STATIC)

if(ENABLE_TCC)
  list(APPEND ffi_LIBRARIES_shared ${libtcc-shared_LIBRARY} m)

  if(BUILD_STATIC)
    build_libtcc(libtcc-static)
    list(APPEND ffi_LIBRARIES_static ${libtcc-static_LIBRARY} m)
  endif(BUILD_STATIC)
endif(ENABLE_TCC)

if(LIBDL)
  list(APPEND ffi_LIBRARIES_static ${LIBDL})
endif(LIBDL)

set(ffi_LIBRARIES ${ffi_LIBRARIES_shared})
make_module(ffi ${JS_BINDINGS_SOURCES})

foreach(_t qjs-ffi qjs-ffi-static)
  if(NOT TARGET ${_t})
    continue()
  endif(NOT TARGET ${_t})

  string(REPLACE "qjs-ffi" "" _variant "${_t}") # "" or "-static"
  string(REGEX REPLACE "^-" "" _variant "${_variant}")

  if(NOT _variant)
    set(_variant shared)
  endif(NOT _variant)

  target_compile_definitions(${_t} PRIVATE JS_BINDINGS_INIT_MODULE=1)

  if(LIBFFI_BUILD)
    add_dependencies(${_t} libffi-${_variant})
  endif(LIBFFI_BUILD)

  if(ENABLE_TCC)
    target_compile_definitions(${_t} PRIVATE CONFIG_TCC=1 "CONFIG_TCC_LIB_DIR=\"${libtcc-${_variant}_LIB_DIR}\"")
    target_include_directories(${_t} PRIVATE "${libtcc-${_variant}_INCLUDE_DIR}")
    add_dependencies(${_t} libtcc-${_variant})
  endif(ENABLE_TCC)
endforeach(_t)

if(NOT CMAKE_INSTALL_LIBDIR)
  set(CMAKE_INSTALL_LIBDIR lib)
endif(NOT CMAKE_INSTALL_LIBDIR)
if(NOT QUICKJS_C_MODULE_DIR)
  set(QUICKJS_C_MODULE_DIR "${CMAKE_INSTALL_LIBDIR}/quickjs")
endif(NOT QUICKJS_C_MODULE_DIR)
if(NOT CMAKE_INSTALL_BINDIR)
  set(CMAKE_INSTALL_BINDIR bin)
endif(NOT CMAKE_INSTALL_BINDIR)

# lib/ffi/legacy.js (define()/call() on top of CFunction) sits in the build directory too,
# so that one QUICKJS_MODULE_PATH finds it.
configure_file(lib/ffi/legacy.js "${CMAKE_CURRENT_BINARY_DIR}/ffi/legacy.js" COPYONLY)

# node/ffi.js (the API of node:ffi on top of this module) sits in the build directory too.
configure_file(lib/node/ffi.js "${CMAKE_CURRENT_BINARY_DIR}/node/ffi.js" COPYONLY)

# lib/ (bindings/*.js generated bindings, ffi/legacy.js, node/ffi.js, posix/*.js) is installed as a tree.
install(
  DIRECTORY lib/
  DESTINATION "${QUICKJS_JS_MODULE_DIR}"
  FILES_MATCHING PATTERN "*.js"
)

if(NOT CMAKE_INSTALL_DATADIR)
  set(CMAKE_INSTALL_DATADIR share)
endif(NOT CMAKE_INSTALL_DATADIR)

# tools/*.js are qjsm scripts, not compiled binaries. gen-bindings.js imports
# the modules in tools/gen-bindings/ relative to its own path, which qjsm
# resolves against the path the script is run as, not a symlink's target. So
# the tree is installed as a whole and bin/ gets two-line wrappers importing
# it by its installed path.
install(DIRECTORY tools/ DESTINATION "${CMAKE_INSTALL_DATADIR}/qjs-ffi/tools" FILES_MATCHING PATTERN "*.js")
install(PROGRAMS tools/describe.sh DESTINATION "${CMAKE_INSTALL_DATADIR}/qjs-ffi/tools")
install(CODE "set(QJS_FFI_BINDIR \"${CMAKE_INSTALL_BINDIR}\")
set(QJS_FFI_DATADIR \"${CMAKE_INSTALL_DATADIR}\")")
install(SCRIPT cmake/install-tool-wrappers.cmake)

include(CTest)

#file(GLOB TESTS tests/*.js)
#foreach(TEST ${TESTS})
#  basename(NAME "${TEST}")
#  add_test(NAME "${NAME}" WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" COMMAND sh "${TEST}")
#endforeach()

add_test(NAME "tests/run-all.sh" WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" COMMAND sh "tests/run-all.sh")
