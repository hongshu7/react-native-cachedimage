'use strict';

const _ = require('lodash');
const React = require('react');
const ReactNative = require('react-native');
const createReactClass = require('create-react-class');
const flattenStyle = ReactNative.StyleSheet.flatten;
const ImageCacheProvider = require('./ImageCacheProvider');
const PropTypes = require('prop-types');
const {
    Image,
    ActivityIndicator,
    NetInfo,
    Platform
} = ReactNative;


const {
    StyleSheet
} = ReactNative;

const styles = StyleSheet.create({
    image: {
        backgroundColor: 'transparent'
    },
    loader: {
        backgroundColor: 'transparent',
    },
    loaderPlaceholder: {
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center'
    }
});

function getImageProps(props) {
    return _.omit(props, ['source', 'defaultSource', 'activityIndicatorProps', 'style', 'useQueryParamsInCacheKey', 'renderImage', 'resolveHeaders']);
}

const CACHED_IMAGE_REF = 'cachedImage';

const CachedImage = createReactClass({
    propTypes: {
        renderImage: PropTypes.func.isRequired,
        activityIndicatorProps: PropTypes.object.isRequired,
        useQueryParamsInCacheKey: PropTypes.oneOfType([
            PropTypes.bool,
            PropTypes.array
        ]).isRequired,
        resolveHeaders: PropTypes.func
    },

    getDefaultProps() {
        return {
            renderImage: props => (<Image ref={CACHED_IMAGE_REF} {...props}/>),
            activityIndicatorProps: {},
            useQueryParamsInCacheKey: false,
            resolveHeaders: () => Promise.resolve({})
        };
    },

    setNativeProps(nativeProps) {
        try {
            this.refs[CACHED_IMAGE_REF].setNativeProps(nativeProps);
        } catch (e) {
            console.error(e);
        }
    },

    getInitialState() {
        this._isMounted = false;
        return {
            isLoading: false,
            isBreak: false,
            cachedImagePath: null,
            networkAvailable: true
        };
    },

    safeSetState(newState) {
        if (!this._isMounted) {
            return;
        }
        return this.setState(newState);
    },

    componentWillMount() {
        this._isMounted = true;
        NetInfo.isConnected.addEventListener('change', this.handleConnectivityChange);
        // initial
        NetInfo.isConnected.fetch()
            .then(isConnected => {
                this.safeSetState({
                    networkAvailable: isConnected
                });
            }).done();
        //console.log('cache image componentWillMount');
        this.processSource(this.props.source);
    },

    componentWillUnmount() {
        this._isMounted = false;
        NetInfo.isConnected.removeEventListener('change', this.handleConnectivityChange);
    },

    componentWillReceiveProps(nextProps) {
        if (!_.isEqual(this.props.source, nextProps.source)) {
            //console.log('cache image componentWillReceiveProps');
            this.processSource(nextProps.source);
        }
    },

    handleConnectivityChange(isConnected) {
        this.safeSetState({
            networkAvailable: isConnected
        });
    },

    processSource(source) {
        const url = _.get(source, ['uri'], null);
        if (ImageCacheProvider.isCacheable(url)) {
            const options = _.pick(this.props, ['useQueryParamsInCacheKey', 'cacheGroup']);
            // try to get the image path from cache
            ImageCacheProvider.getCachedImagePath(url, options)
                .then(cachedImagePath => {
                    // image has cached
                    this.safeSetState({
                        isLoading: false,
                        isBreak: false,
                        cachedImagePath
                    });
                })
                .catch(() => {
                    // try to put the image in cache if not exists
                    ImageCacheProvider.cacheImage(url, options, this.props.resolveHeaders)
                        .then(cachedImagePath => {
                            // image downloaded and cached
                            this.safeSetState({
                                isLoading: false,
                                isBreak: false,
                                cachedImagePath
                            });
                        })
                        .catch(err => {
                            //console.log('cache image download failed:'+url);
                            this.safeSetState({
                                isLoading: false,
                                isBreak: true,
                                cachedImagePath: null
                            });
                        })
                       
                        .done();
                })
                .done();
                
            this.safeSetState({
                isLoading: true
            });
        } else {
            this.safeSetState({
                isLoading: false,
                isBreak: false,
                cachedImagePath: null
            });
        }
    },

    render() {
        if (this.state.isLoading) {
            return this.renderLoader();
        }
        //console.log('=== *isBreak:' + this.state.isBreak);
        //console.log('=== *cachedImagePath:' + this.state.cachedImagePath);
        const props = getImageProps(this.props);
        const style = this.props.style || styles.image;
        let source = this.props.defaultSource;
        if (!this.state.isBreak) {
            if (this.state.cachedImagePath) {
                source = {uri: 'file://' + this.state.cachedImagePath}
            } else {
                source =  this.props.source;
            }
        }
        return this.props.renderImage({
            ...props,
            key: props.key || source.uri,
            style,
            source
        });
    },

    renderLoader() {
        const imageProps = getImageProps(this.props);
        const imageStyle = [this.props.style, styles.loaderPlaceholder];

        const activityIndicatorProps = _.omit(this.props.activityIndicatorProps, ['style']);
        const activityIndicatorStyle = this.props.activityIndicatorProps.style || styles.loader;

        const source = this.props.defaultSource;

        // if the imageStyle has borderRadius it will break the loading image view on android
        // so we only show the ActivityIndicator
        if (!source || (Platform.OS === 'android' && flattenStyle(imageStyle).borderRadius)) {
            return (
                <ActivityIndicator
                    {...activityIndicatorProps}
                    style={[imageStyle, activityIndicatorStyle]}/>
            );
        }
        // otherwise render an image with the defaultSource with the ActivityIndicator on top of it
        return this.props.renderImage({
            ...imageProps,
            style: imageStyle,
            key: source.uri,
            source,
            children: (
                <ActivityIndicator
                    {...activityIndicatorProps}
                    style={activityIndicatorStyle}/>
            )
        });
    }
});

/**
 * Same as ReactNaive.Image.getSize only it will not download the image if it has a cached version
 * @param uri
 * @param success
 * @param failure
 * @param options
 */
CachedImage.getSize = function getSize(uri, success, failure, options) {
    if (ImageCacheProvider.isCacheable(uri)) {
        ImageCacheProvider.getCachedImagePath(uri, options)
            .then(imagePath => {
                if (Platform.OS === 'android') {
                    imagePath = 'file://' + imagePath;
                }
                Image.getSize(imagePath, success, failure);
            })
            .catch(err => {
                Image.getSize(uri, success, failure);
            })
            .done();
    } else {
        Image.getSize(uri, success, failure);
    }
};

CachedImage.ImageCacheProvider = ImageCacheProvider;

module.exports = CachedImage;
