from setuptools import setup, find_packages

setup(
    name="bis-sdk",
    version="1.0.0",
    description="Official Python SDK for the BIS (Background Intelligence System) API",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="BIS Engineering",
    author_email="api@bis.example.ng",
    url="https://github.com/bis-platform/bis-python-sdk",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[],  # Zero dependencies — uses stdlib only
    extras_require={
        "dev": ["pytest", "pytest-mock", "responses"],
    },
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Developers",
        "License :: Other/Proprietary License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
    keywords="bis background-intelligence kyc aml nigeria fintech",
)
