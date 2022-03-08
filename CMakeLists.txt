cmake_minimum_required(VERSION 3.0)
project(qjs-ffi C)

set(DISABLE_WERROR ON)

include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/UseMultiArch.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/FindQuickJS.cmake)

include(FindPkgConfig)

pkg_search_module(LIBFFI libffi)

if(pkgcfg_lib_LIBFFI_ffi)
  set(LIBFFI_LIBRARY ${pkgcfg_lib_LIBFFI_ffi})
endif(pkgcfg_lib_LIBFFI_ffi)

if(NOT LIBFFI_FOUND)
  find_library(LIBFFI_LIBRARY ffi)
endif(NOT LIBFFI_FOUND)

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

include_directories(${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/.. ${CMAKE_CURRENT_SOURCE_DIR}/../..)
if(CMAKE_SYSTEM_INCLUDE_PATH)
  include_directories(${CMAKE_SYSTEM_INCLUDE_PATH})
endif(CMAKE_SYSTEM_INCLUDE_PATH)

set(DISABLE_WERROR TRUE)

function(make_shared_module FNAME)
  string(REGEX REPLACE "_" "-" NAME "${FNAME}")
  string(TOUPPER "${FNAME}" UNAME)

  message("Module: ${NAME}")
  set(TARGET_NAME quickjs-${NAME})

  add_library(${TARGET_NAME} SHARED ${FNAME}.c)

  target_link_libraries(${TARGET_NAME} ${QUICKJS_LIBRARY} ${LIBFFI_LIBRARY})
  set_target_properties(${TARGET_NAME} PROPERTIES PREFIX "" BUILD_RPATH "${CMAKE_CURRENT_BINARY_DIR}" INSTALL_RPATH "${CMAKE_INSTALL_PREFIX}/lib" OUTPUT_NAME "${NAME}" # COMPILE_FLAGS "-fvisibility=hidden"
                                                  BUILD_RPATH "${CMAKE_BINARY_DIR};${CMAKE_CURRENT_BINARY_DIR};${CMAKE_BINARY_DIR}/quickjs;${CMAKE_CURRENT_BINARY_DIR}/quickjs")
  target_compile_definitions(${TARGET_NAME} PRIVATE -DJS_${UNAME}_MODULE=1)
  install(TARGETS ${TARGET_NAME} DESTINATION ${QUICKJS_LIBRARY_DIR}/quickjs PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)

endfunction()

file(GLOB JS_BINDINGS_SOURCES ffi.c)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(CheckLibraryExists)

include(FindPkgConfig)
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

if(HAVE_LIBFFI)
  link_libraries(${LIBFFI_LIBRARY})
endif(HAVE_LIBFFI)

if(BUILD_SHARED_LIBS)
  add_definitions(-DJS_SHARED_LIBRARY)
endif(BUILD_SHARED_LIBS)

# Main
add_library(quickjs-ffi MODULE ${JS_BINDINGS_SOURCES})
target_include_directories(quickjs-ffi PRIVATE)
set_target_properties(quickjs-ffi PROPERTIES PREFIX "" OUTPUT_NAME "ffi")
target_compile_definitions(quickjs-ffi PRIVATE -DJS_SHARED_LIBRARY=1 -DJS_BINDINGS_INIT_MODULE=1)
target_link_libraries(quickjs-ffi PUBLIC ${QUICKJS_LIBRARY} ${FFI_LIBRARIES})

if(NOT CMAKE_INSTALL_LIBDIR)
  set(CMAKE_INSTALL_LIBDIR lib)
endif(NOT CMAKE_INSTALL_LIBDIR)
if(NOT QUICKJS_C_MODULE_DIR)
  set(QUICKJS_C_MODULE_DIR "${CMAKE_INSTALL_LIBDIR}/quickjs")
endif(NOT QUICKJS_C_MODULE_DIR)

install(TARGETS quickjs-ffi DESTINATION "${QUICKJS_C_MODULE_DIR}" PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)
